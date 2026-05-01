export default function TransactionList({ transactions }) {
  if (!transactions.length) return <p className="text-muted">No transactions found.</p>;

  return (
    <table className="table table-striped">
      <thead>
        <tr>
          <th>Date</th>
          <th>Type</th>
          <th>Amount</th>
          <th>Category</th>
        </tr>
      </thead>
      <tbody>
        {transactions.map((txn) => (
          <tr key={txn._id}>
            <td>{new Date(txn.date).toLocaleDateString()}</td>
            <td>{txn.type}</td>
            <td>${txn.amount.toFixed(2)}</td>
            <td>{txn.category}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
