const infrastructureService = require('../services/infrastructureService');

async function getDockerOverview(req, res, next) {
  try {
    const overview = await infrastructureService.getDockerOverview();
    res.json({
      ok: true,
      overview,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getDockerOverview,
};
