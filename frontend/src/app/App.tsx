import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client';
import type { MqttStatus } from '../types/api';
import { SettingsPage } from '../features/settings/SettingsPage';
import { LightControlPage } from '../features/light-control/LightControlPage';
import { WarehousePage } from '../features/warehouse/WarehousePage';
import { InventoryPage } from '../features/inventory/InventoryPage';
import { PicklistsPage } from '../features/picklists/PicklistsPage';
import { DebugPage } from '../features/debug/DebugPage';
import '../../../css/styles.css';
import './app.css';

type Page = 'home' | 'light' | 'warehouse' | 'inventory' | 'settings' | 'debug';

const pages: Array<{ id: Page; label: string }> = [
  { id: 'home', label: 'Home' },
  { id: 'light', label: 'Light Control' },
  { id: 'warehouse', label: 'Warehouse' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'settings', label: 'Settings' },
  { id: 'debug', label: 'Debug Console' },
];

export function App() {
  const [page, setPage] = useState<Page>('home');
  const [mqtt, setMqtt] = useState<MqttStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<Record<string, boolean>>({
    show_light_control: true,
    show_wh_db: true,
    show_wh_config: true,
    show_debug_console: true,
  });
  const handleMqttChange = useCallback((status: MqttStatus) => setMqtt(status), []);
  const handleError = useCallback((message: string | null) => setError(message), []);

  useEffect(() => {
    let cancelled = false;

    const refreshStatus = async () => {
      try {
        const status = await api.getMqttStatus();
        if (!cancelled) {
          setMqtt(status);
          setError(null);
        }
      } catch (requestError) {
        if (!cancelled) {
          setError(requestError instanceof Error ? requestError.message : 'Unable to reach the server');
        }
      }
    };

    void refreshStatus();
    const interval = window.setInterval(() => void refreshStatus(), 2500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    void api.getSettings().then((settings) => setVisibility((current) => ({
      ...current,
      show_light_control: settings.show_light_control !== 'false',
      show_wh_db: settings.show_wh_db !== 'false',
      show_wh_config: settings.show_wh_config !== 'false',
      show_debug_console: settings.show_debug_console !== 'false',
    }))).catch(() => undefined);
  }, []);

  const visiblePages = pages.filter((item) => (
    item.id === 'home' || item.id === 'settings' ||
    (item.id === 'light' && visibility.show_light_control) ||
    (item.id === 'warehouse' && visibility.show_wh_config) ||
    (item.id === 'inventory' && visibility.show_wh_db)
    || (item.id === 'debug' && visibility.show_debug_console)
  ));

  return (
    <div className="shell">
      <header className="topbar">
        <div className="brand">
          <button className="brand-mark" aria-label="Go to Home" onClick={() => setPage('home')} type="button">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 11.5 12 4l9 7.5" stroke="#062622" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/><path d="M5.5 10v9a1 1 0 0 0 1 1H9a1 1 0 0 0 1-1v-4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v4a1 1 0 0 0 1 1h2.5a1 1 0 0 0 1-1v-9" stroke="#062622" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
          <div className="brand-text">
            <div className="t1">Smart Light Automation</div>
            <div className="t2">React frontend</div>
          </div>
        </div>
        <div className="topbar-status" role="status">
          <span className={`dot ${mqtt?.connected ? 'connected' : ''}`} />
          <span id="statusText">{error ?? (mqtt?.connected ? 'Broker: connected' : 'Broker: disconnected')}</span>
        </div>
      </header>

      <div className="app-body">
        <nav className="tab-nav" aria-label="Main navigation">
          {visiblePages.map((item) => (
            <button
              className={page === item.id ? 'tab-btn active' : 'tab-btn'}
              key={item.id}
              onClick={() => setPage(item.id)}
              type="button"
            >
              {item.label}
            </button>
          ))}
        </nav>

        <main className="tab-content-wrap">
          {error && (
            <div className="panel error-card" role="alert">
              {error}
            </div>
          )}

          {page === 'settings' ? (
            <SettingsPage mqtt={mqtt} onMqttChange={handleMqttChange} onError={handleError} onNavigate={setPage} onVisibilityChange={(key, visible) => setVisibility((current) => ({ ...current, [key]: visible }))} />
          ) : page === 'light' ? (
            <LightControlPage mqtt={mqtt} onError={handleError} />
          ) : page === 'warehouse' ? (
            <WarehousePage mqtt={mqtt} onError={handleError} />
          ) : page === 'home' ? (
            <PicklistsPage mqtt={mqtt} onError={handleError} />
          ) : page === 'inventory' ? (
            <InventoryPage onError={handleError} />
          ) : page === 'debug' ? (
            <DebugPage onError={handleError} />
          ) : (
            <section className="feature-placeholder">
              <h2>{page === 'home' ? 'Migration status' : `${pages.find((item) => item.id === page)?.label} migration`}</h2>
              <p>Feature migration will be implemented in the next step.</p>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}
