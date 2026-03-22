import { FormEvent, useEffect, useState } from "react";

type ConnectionPanelProps = {
  apiBase: string;
  onSave: (apiBase: string) => void;
  onReset: () => void;
  errorMessage: string | null;
};

export function ConnectionPanel(props: ConnectionPanelProps) {
  const { apiBase, onSave, onReset, errorMessage } = props;
  const [draftValue, setDraftValue] = useState(apiBase);

  useEffect(() => {
    setDraftValue(apiBase);
  }, [apiBase]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSave(draftValue);
  }

  return (
    <section className="panel control-panel">
      <h2>Connection</h2>
      <p>
        Point the extracted dashboard at the game server you want to observe.
        For local play, the default is still http://127.0.0.1:3000.
      </p>
      <form onSubmit={handleSubmit} className="connection-form">
        <label>
          <span>Dashboard API server</span>
          <input
            type="url"
            value={draftValue}
            onChange={(event) => setDraftValue(event.target.value)}
            placeholder="http://127.0.0.1:3000"
          />
        </label>
        <div className="button-row">
          <button type="submit">Save API Base</button>
          <button type="button" className="ghost" onClick={onReset}>
            Reset To Local Default
          </button>
        </div>
      </form>
      {errorMessage ? <div className="notice error">{errorMessage}</div> : null}
    </section>
  );
}
