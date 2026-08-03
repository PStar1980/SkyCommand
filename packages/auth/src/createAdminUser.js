#!/usr/bin/env node

require('../../../scripts/node/util/bootstrap');

const readline = require('readline');
const { pool } = require('../../db/src/connection');
const { hashPassword } = require('./password');

const ADMIN_APP_CODE = String(process.env.AUTH_APP_CODE || 'SKYSERVER_ADMIN')
  .trim()
  .toUpperCase();

function askQuestion(query, options = {}) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  if (options.hidden) {
    rl.stdoutMuted = true;
    rl._writeToOutput = function writeToOutput(stringToWrite) {
      if (rl.stdoutMuted && stringToWrite.trim() !== '') {
        rl.output.write('*');
        return;
      }

      rl.output.write(stringToWrite);
    };
  }

  return new Promise((resolve) => {
    rl.question(query, (answer) => {
      rl.close();

      if (options.hidden) {
        process.stdout.write('\n');
      }

      resolve(answer.trim());
    });
  });
}

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase();
}

function normalizeOptionalText(value) {
  const trimmed = String(value || '').trim();
  return trimmed === '' ? null : trimmed;
}

async function getActiveRoles(client) {
  const result = await client.query(
    `
      SELECT role_code, role_name, description
      FROM auth.roles r
      JOIN core.applications app
        ON app.app_id = r.app_id
      WHERE r.active = TRUE
        AND app.app_code = $1
      ORDER BY
        CASE role_code
          WHEN 'SUPER_ADMIN' THEN 1
          WHEN 'ADMIN' THEN 2
          WHEN 'OPERATOR' THEN 3
          WHEN 'VIEWER' THEN 4
          ELSE 99
        END,
        role_code
    `,
    [ADMIN_APP_CODE],
  );

  return result.rows;
}

async function selectRole(client) {
  const roles = await getActiveRoles(client);

  if (roles.length === 0) {
    throw new Error('No active roles found in auth.roles. Run the auth seed script first.');
  }

  console.log('\nAvailable roles:');

  roles.forEach((role, index) => {
    console.log(`${index + 1}) ${role.role_code} - ${role.role_name}`);
  });

  const answer = await askQuestion('\nSelect role [default 1]: ');

  if (answer === '') {
    return roles[0];
  }

  const index = Number.parseInt(answer, 10);

  if (Number.isNaN(index) || index < 1 || index > roles.length) {
    throw new Error('Invalid role selection.');
  }

  return roles[index - 1];
}

async function createAdminUser() {
  console.log('\n==========================================');
  console.log('          Create SkyCommand Admin User');
  console.log('==========================================\n');

  const client = await pool.connect();
  let transactionStarted = false;

  try {
    const selectedRole = await selectRole(client);

    const email = normalizeEmail(await askQuestion('Email: '));
    const username = normalizeOptionalText(await askQuestion('Username optional: '));
    const displayName = normalizeOptionalText(await askQuestion('Display name: '));
    const password = await askQuestion('Password minimum 12 chars: ', { hidden: true });
    const confirmPassword = await askQuestion('Confirm password: ', { hidden: true });

    if (!email) {
      throw new Error('Email is required.');
    }

    if (password !== confirmPassword) {
      throw new Error('Passwords do not match.');
    }

    const passwordHash = await hashPassword(password);

    await client.query('BEGIN');
    transactionStarted = true;

    const existingEmail = await client.query(
      `
        SELECT user_id
        FROM auth.users
        WHERE LOWER(email) = LOWER($1)
        LIMIT 1
      `,
      [email],
    );

    if (existingEmail.rowCount > 0) {
      throw new Error(`User already exists for email: ${email}`);
    }

    if (username) {
      const existingUsername = await client.query(
        `
          SELECT user_id
          FROM auth.users
          WHERE LOWER(username) = LOWER($1)
          LIMIT 1
        `,
        [username],
      );

      if (existingUsername.rowCount > 0) {
        throw new Error(`Username already exists: ${username}`);
      }
    }

    const roleResult = await client.query(
      `
        SELECT role_id, role_code
        FROM auth.roles r
        JOIN core.applications app
          ON app.app_id = r.app_id
        WHERE r.role_code = $1
          AND r.active = TRUE
          AND app.app_code = $2
        LIMIT 1
      `,
      [selectedRole.role_code, ADMIN_APP_CODE],
    );

    if (roleResult.rowCount === 0) {
      throw new Error(`Active role not found: ${selectedRole.role_code}`);
    }

    const userResult = await client.query(
      `
        INSERT INTO auth.users (
          email,
          username,
          display_name,
          password_hash,
          status,
          is_system_user
        )
        VALUES ($1, $2, $3, $4, 'ACTIVE', FALSE)
        RETURNING user_id, email, username, display_name, status
      `,
      [email, username, displayName, passwordHash],
    );

    const user = userResult.rows[0];
    const role = roleResult.rows[0];

    await client.query(
      `
        UPDATE auth.users
        SET created_by = $1,
            updated_by = $1
        WHERE user_id = $1
      `,
      [user.user_id],
    );

    await client.query(
      `
        INSERT INTO auth.user_applications (user_id, app_id, status, created_by, updated_by)
        SELECT $1, app.app_id, 'ACTIVE', $1, $1
        FROM core.applications app
        WHERE app.app_code = $2
        ON CONFLICT (user_id, app_id)
        DO UPDATE SET
          status = 'ACTIVE',
          updated_by = EXCLUDED.updated_by,
          updated_at = CURRENT_TIMESTAMP
      `,
      [user.user_id, ADMIN_APP_CODE],
    );

    await client.query(
      `
        INSERT INTO auth.user_roles (user_id, role_id, assigned_by, active)
        VALUES ($1, $2, $1, TRUE)
      `,
      [user.user_id, role.role_id],
    );

    await client.query(
      `
        INSERT INTO auth.audit_events (
          user_id,
          event_type,
          resource_type,
          resource_id,
          action,
          success,
          message,
          metadata
        )
        VALUES (
          $1,
          'AUTH_USER_ADMIN_CREATE',
          'auth.users',
          $2,
          'create_admin_user',
          TRUE,
          'Admin user created from CLI.',
          $3::jsonb
        )
      `,
      [
        user.user_id,
        String(user.user_id),
        JSON.stringify({
          email: user.email,
          username: user.username,
          displayName: user.display_name,
          roleCode: role.role_code,
          appCode: ADMIN_APP_CODE,
          createdByTool: 'packages/auth/src/createAdminUser.js',
        }),
      ],
    );

    await client.query('COMMIT');
    transactionStarted = false;

    console.log('\n✅ Admin user created successfully');
    console.log(`email=${user.email}`);
    console.log(`username=${user.username || ''}`);
    console.log(`display_name=${user.display_name || ''}`);
    console.log(`status=${user.status}`);
    console.log(`role=${role.role_code}`);
  } catch (error) {
    if (transactionStarted) {
      await client.query('ROLLBACK').catch(() => {});
    }

    console.error('\n❌ Failed to create admin user');
    console.error(error.message);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }
}

createAdminUser();
