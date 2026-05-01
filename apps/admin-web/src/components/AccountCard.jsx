export default function AccountCard({ account }) {
  return (
    <div className="card mb-3 shadow-sm">
      <div className="card-body">
        <h5 className="card-title">{account.name}</h5>
        <p className="card-text text-muted">Balance: ${account.balance.toFixed(2)}</p>
      </div>
    </div>
  );
}
