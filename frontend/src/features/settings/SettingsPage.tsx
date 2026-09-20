import { useEffect, useState } from 'react';
import { api } from '../../api/client';
import type { AppSettings, MqttConfig, MqttStatus } from '../../types/api';
import { TagIcon } from '../../components/TagIcon';

const defaultConfig: MqttConfig = {
  host: '192.168.3.81',
  port: '8083',
  wsPath: '/mqtt',
  clientId: 'SmartLightServer',
  username: 'test',
  password: '123456',
  subTopic: '#',
};

interface SettingsPageProps {
  mqtt: MqttStatus | null;
  onMqttChange: (status: MqttStatus) => void;
  onError: (message: string | null) => void;
  onNavigate?: (page: 'light' | 'warehouse' | 'inventory' | 'debug') => void;
  onVisibilityChange?: (key: string, visible: boolean) => void;
}

export function SettingsPage({ mqtt, onMqttChange, onError, onNavigate, onVisibilityChange }: SettingsPageProps) {
  const [config, setConfig] = useState<MqttConfig>(defaultConfig);
  const [settings, setSettings] = useState<AppSettings>({});
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [saved, setSaved] = useState(false);
  const [iconUrls, setIconUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [loadedSettings, status] = await Promise.all([api.getSettings(), api.getMqttStatus()]);
        if (cancelled) return;
        setSettings(loadedSettings);
        setIconUrls({
          AreaTag: loadedSettings.icon_AreaTag || '',
          ShelfTag: loadedSettings.icon_ShelfTag || '',
          ItemTag: loadedSettings.icon_ItemTag || '',
        });
        setConfig((current) => ({
          ...current,
          host: loadedSettings.mqtt_host || status.config.host || current.host,
          port: loadedSettings.mqtt_port || status.config.port || current.port,
          wsPath: loadedSettings.mqtt_wsPath || status.config.wsPath || current.wsPath,
          clientId: loadedSettings.mqtt_clientId || status.config.clientId || current.clientId,
          username: loadedSettings.mqtt_username || status.config.username || current.username,
          password: loadedSettings.mqtt_password || current.password,
          subTopic: loadedSettings.mqtt_subTopic || status.config.subTopic || current.subTopic,
        }));
        onMqttChange(status);
      } catch (requestError) {
        if (!cancelled) onError(requestError instanceof Error ? requestError.message : 'Unable to load settings');
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [onError, onMqttChange]);

  const updateConfig = (key: keyof MqttConfig, value: string) => {
    setConfig((current) => ({ ...current, [key]: value }));
    setSaved(false);
  };

  const saveConfig = async () => {
    setBusy(true);
    onError(null);
    try {
      const entries: Array<[string, string]> = [
        ['mqtt_host', config.host],
        ['mqtt_port', config.port],
        ['mqtt_wsPath', config.wsPath],
        ['mqtt_clientId', config.clientId],
        ['mqtt_username', config.username],
        ['mqtt_password', config.password || ''],
        ['mqtt_subTopic', config.subTopic],
      ];
      await Promise.all(entries.map(([key, value]) => api.saveSetting(key, value)));
      setSettings((current) => Object.fromEntries([...Object.entries(current), ...entries]));
      setSaved(true);
    } catch (requestError) {
      onError(requestError instanceof Error ? requestError.message : 'Unable to save MQTT settings');
    } finally {
      setBusy(false);
    }
  };

  const connect = async () => {
    setBusy(true);
    onError(null);
    try {
      const status = await api.connectMqtt(config);
      onMqttChange(status);
      setSaved(false);
    } catch (requestError) {
      onError(requestError instanceof Error ? requestError.message : 'Unable to connect to MQTT broker');
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    setBusy(true);
    onError(null);
    try {
      await api.disconnectMqtt();
      const status = await api.getMqttStatus();
      onMqttChange(status);
    } catch (requestError) {
      onError(requestError instanceof Error ? requestError.message : 'Unable to disconnect from MQTT broker');
    } finally {
      setBusy(false);
    }
  };

  const checkConnection = async () => {
    setChecking(true);
    onError(null);
    try {
      const status = await api.getMqttStatus();
      onMqttChange(status);
    } catch (requestError) {
      onError(requestError instanceof Error ? requestError.message : 'Unable to check MQTT status');
    } finally {
      setChecking(false);
    }
  };

  const visibilityKeys = [
    ['show_light_control', 'Show Light Control subpage'],
    ['show_wh_db', 'Show Warehouse Database subpage'],
    ['show_wh_config', 'Show Warehouse Config subpage'],
    ['show_debug_console', 'Show Debug Console subpage'],
  ] as const;

  const updateSetting = async (key: string, value: string) => {
    try {
      await api.saveSetting(key, value);
      setSettings((current) => ({ ...current, [key]: value }));
      if (key.startsWith('show_')) onVisibilityChange?.(key, value === 'true');
    } catch (requestError) {
      onError(requestError instanceof Error ? requestError.message : 'Unable to save setting');
    }
  };

  const uploadIcon = (type: string, file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const value = typeof reader.result === 'string' ? reader.result : '';
      if (!value) return;
      void updateSetting(`icon_${type}`, value).then(() => setIconUrls((current) => ({ ...current, [type]: value })));
    };
    reader.readAsDataURL(file);
  };

  const clearIcon = async (type: string) => {
    try {
      await api.deleteSetting(`icon_${type}`);
      setIconUrls((current) => ({ ...current, [type]: '' }));
      setSettings((current) => { const next = { ...current }; delete next[`icon_${type}`]; return next; });
    } catch (requestError) {
      onError(requestError instanceof Error ? requestError.message : 'Unable to clear custom icon');
    }
  };

  return (
    <div className="settings-page">
      <section className="panel">
        <div className="panel-head"><h3>Advanced Subpage Quick Access</h3></div>
        <div className="panel-body"><p className="hint">Jump directly to specialized subpages without cluttering the main menu bar.</p><div className="quick-access-grid">
          <button className="btn-block btn-accent" onClick={() => onNavigate?.('light')} type="button">Light Control</button>
          <button className="btn-block btn-accent" onClick={() => onNavigate?.('inventory')} type="button">Warehouse Database</button>
          <button className="btn-block btn-accent" onClick={() => onNavigate?.('warehouse')} type="button">Warehouse Config</button>
          <button className="btn-block btn-accent" onClick={() => onNavigate?.('debug')} type="button">Debug Console</button>
        </div></div>
      </section>
      <section className="panel">
        <div className="panel-head"><h3>Desktop / Sidebar Visibility Options</h3></div>
        <div className="panel-body visibility-options"><p className="hint">Control which optional subpages appear in the desktop sidebar menu.</p>
          {visibilityKeys.map(([key, label]) => <label className="legacy-checkbox" key={key}><input type="checkbox" checked={settings[key] === 'true'} onChange={(event) => void updateSetting(key, String(event.target.checked))} />{label}</label>)}
        </div>
      </section>
      <section className="settings-card">
        <p className="eyebrow">Configuration</p>
        <h2>Server broker gateway</h2>
        <p>Configure the server-side MQTT connection. Credentials are sent only to the existing backend API.</p>
        <div className="form-grid">
          <label>Host<input value={config.host} onChange={(event) => updateConfig('host', event.target.value)} /></label>
          <label>Port<input type="number" value={config.port} onChange={(event) => updateConfig('port', event.target.value)} /></label>
          <label>WebSocket path<input value={config.wsPath} onChange={(event) => updateConfig('wsPath', event.target.value)} /></label>
          <label>Client ID<input value={config.clientId} onChange={(event) => updateConfig('clientId', event.target.value)} /></label>
          <label>Username<input value={config.username} onChange={(event) => updateConfig('username', event.target.value)} /></label>
          <label>Password<input type="password" value={config.password || ''} onChange={(event) => updateConfig('password', event.target.value)} /></label>
          <label className="full-width">Subscribe topic<input value={config.subTopic} onChange={(event) => updateConfig('subTopic', event.target.value)} /></label>
        </div>
        <div className="button-row">
          <button className="button secondary" disabled={checking} onClick={() => void checkConnection()} type="button">{checking ? 'Checking...' : 'Check status'}</button>
          <button className="button secondary" disabled={busy} onClick={() => void saveConfig()} type="button">{saved ? 'Saved' : 'Save settings'}</button>
          <button className="button primary" disabled={busy || mqtt?.connected} onClick={() => void connect()} type="button">Connect</button>
          <button className="button danger" disabled={busy || !mqtt?.connected} onClick={() => void disconnect()} type="button">Disconnect</button>
        </div>
      </section>
      <section className="panel">
        <div className="panel-head"><h3>Tag Config · Custom Icons</h3></div>
        <div className="panel-body icon-settings"><p className="hint">Upload custom image icons for each tag type. Uploaded icons are stored in the database and visible across browsers.</p>
          {(['AreaTag', 'ShelfTag', 'ItemTag'] as const).map((type) => <div className="icon-setting-row" key={type}><div className="icon-setting-preview">{iconUrls[type] ? <img src={iconUrls[type]} alt={`${type} custom`} /> : <TagIcon type={type} />}</div><div className="icon-setting-label"><strong>{type.replace('Tag', ' Tags')}</strong><span className="hint">Icon for {type} cards</span></div><input id={`icon-file-${type}`} hidden accept="image/*" type="file" onChange={(event) => { const file = event.target.files?.[0]; if (file) uploadIcon(type, file); event.currentTarget.value = ''; }} /><button className="btn-sm btn-primary" onClick={() => document.getElementById(`icon-file-${type}`)?.click()} type="button">Upload Image</button><button className="btn-sm btn-danger" onClick={() => void clearIcon(type)} type="button">Clear Image</button></div>)}
        </div>
      </section>

      <section className="settings-card">
        <p className="eyebrow">Runtime status</p>
        <h2>Base station</h2>
        <div className="status-grid">
          <span>Broker</span><strong>{mqtt?.connected ? 'Connected' : mqtt?.connecting ? 'Connecting' : 'Disconnected'}</strong>
          <span>Traffic</span><strong>{mqtt?.apTrafficSeen ? 'Detected' : 'No traffic seen'}</strong>
          <span>AP ID</span><strong>{mqtt?.apInfo.ID || '—'}</strong>
          <span>AP IP</span><strong>{mqtt?.apInfo.IP || '—'}</strong>
          <span>AP MAC</span><strong>{mqtt?.apInfo.MAC || '—'}</strong>
          <span>Firmware</span><strong>{mqtt?.apInfo.Firmware || '—'}</strong>
        </div>
      </section>

      <section className="settings-card">
        <p className="eyebrow">Application</p>
        <h2>Preferences</h2>
        <label className="inline-field">Activated task timeout (minutes)
          <input type="number" min="1" max="1440" value={settings.task_timeout_minutes || '10'} onChange={(event) => void updateSetting('task_timeout_minutes', event.target.value)} />
        </label>
        <div className="checkbox-list">
          {visibilityKeys.map(([key, label]) => (
            <label className="checkbox-field" key={key}>
              <input type="checkbox" checked={settings[key] === 'true'} onChange={(event) => void updateSetting(key, String(event.target.checked))} />
              {label}
            </label>
          ))}
        </div>
      </section>
    </div>
  );
}
