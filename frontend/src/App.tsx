import { useCallback, useEffect, useState } from 'react';
import { DEMO_ACTORS, type PersonaKey } from '@core/seed';
import { ActivityView } from './views/ActivityView';
import { ContractsView } from './views/ContractsView';
import { SourcingView } from './views/SourcingView';
import { useDemo } from './state/store';

type Tab = 'sourcing' | 'contracts' | 'activity';
const INTERNAL: PersonaKey[] = ['buyer', 'pm', 'commercial', 'director'];
const SUPPLIER: PersonaKey[] = ['granite', 'riverside', 'summit'];

export function App() {
  const { platform, init, persona, setPersona, toast, dismissToast, clock, advanceDays, daysAdvanced } = useDemo();
  const tick = useDemo((s) => s.tick);
  const [tab, setTab] = useState<Tab>('sourcing');
  const [contractId, setContractId] = useState<string | null>(null);
  const selectContract = useCallback((id: string) => setContractId(id), []);

  useEffect(() => {
    void init();
  }, [init]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(dismissToast, toast.kind === 'error' ? 6000 : 3000);
    return () => clearTimeout(t);
  }, [toast, dismissToast]);

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <h1>Procurement &amp; contracts PoC</h1>
          <span className="sub">RFx sourcing → sealed bids → levelling → award → contract → change orders</span>
        </div>
        <div className="controls">
          <label>
            Acting as
            <select aria-label="Persona" value={persona} onChange={(e) => setPersona(e.target.value as PersonaKey)}>
              <optgroup label="Internal">
                {INTERNAL.map((k) => (
                  <option key={k} value={k}>{DEMO_ACTORS[k].name}</option>
                ))}
              </optgroup>
              <optgroup label="Supplier portal">
                {SUPPLIER.map((k) => (
                  <option key={k} value={k}>{DEMO_ACTORS[k].name}</option>
                ))}
              </optgroup>
            </select>
          </label>
          <div className="clock" key={tick}>
            Today <strong>{clock ? clock.now().toISOString().slice(0, 10) : '…'}</strong>
            {daysAdvanced > 0 && <span className="muted"> (+{daysAdvanced} d)</span>}
            <button className="ghost small" onClick={() => advanceDays(7)} title="Move the demo clock forward (bid deadlines)">
              +7 days
            </button>
          </div>
        </div>
      </header>
      <nav className="tabs" role="tablist">
        {(['sourcing', 'contracts', 'activity'] as Tab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
            {t === 'sourcing' ? 'Sourcing (RFx)' : t === 'contracts' ? 'Contracts & change orders' : 'Events & audit'}
          </button>
        ))}
        <span className="hint">Runs entirely in your browser with the real domain services. Fictional data.</span>
      </nav>
      <main>
        {!platform ? (
          <p className="pad">Loading…</p>
        ) : tab === 'sourcing' ? (
          <SourcingView
            onOpenContract={(id) => {
              setContractId(id);
              setTab('contracts');
            }}
          />
        ) : tab === 'contracts' ? (
          <ContractsView contractId={contractId} onSelect={selectContract} />
        ) : (
          <ActivityView />
        )}
      </main>
      {toast && (
        <div className={`toast ${toast.kind}`} role="status" onClick={dismissToast}>
          {toast.text}
        </div>
      )}
      <footer className="foot">
        Independent proof of concept by Mohamed Abo Elmagd · <a href="https://github.com/mohamedaboelmagd/procurement-contracts-poc">source on GitHub</a> · all organisations, people and numbers are fictional
      </footer>
    </div>
  );
}
