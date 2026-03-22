import type { HeaderStatus } from "../dashboardModel";

type AppHeaderProps = {
  boardStatus: HeaderStatus;
};

export function AppHeader(props: AppHeaderProps) {
  return (
    <header>
      <div className="brand-block">
        <div className="brand-kicker">Arena Of Recursive Ruin</div>
        <h1>Neural Necropolis</h1>
        <div className="subtitle">Where Dead Code Dreams of Vengeance</div>
      </div>
    </header>
  );
}
