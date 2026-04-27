import Activity from "./Activity";

export default function Transactions() {
  return (
    <Activity
      title="Transactions"
      subtitle="Monitor your transaction history with cleaner merchant labels and quick filters."
      compactTableView
      hideAnomalyCard
      hideAssistantTools
    />
  );
}
