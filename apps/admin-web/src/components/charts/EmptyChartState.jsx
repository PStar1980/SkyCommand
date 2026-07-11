function EmptyChartState({ message = 'No chart data available yet.', title = 'No data' }) {
  return (
    <div className="sky-chart-empty-state" role="status">
      <div className="sky-chart-empty-orb" aria-hidden="true" />
      <div>
        <h3>{title}</h3>
        <p>{message}</p>
      </div>
    </div>
  );
}

export default EmptyChartState;
