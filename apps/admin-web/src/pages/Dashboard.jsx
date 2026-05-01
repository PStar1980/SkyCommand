import { useEffect, useState } from 'react';
import { getTransactions } from '../services/userService';
import AccountCard from '../components/AccountCard';
import TransactionList from '../components/TransactionList';

export default function Dashboard() {
  const [transactions, setTransactions] = useState([]);
  const [account] = useState({ name: 'Main Account', balance: 1200 });

  useEffect(() => {
    (async () => {
      const data = await getTransactions();
      setTransactions(data);
    })();
  }, []);

  return (
    <div className="container mt-4">
      <h2>Dashboard</h2>
      <AccountCard account={account} />
      <TransactionList transactions={transactions} />
    </div>
  );
}
