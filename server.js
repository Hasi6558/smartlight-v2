const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const mqtt = require('mqtt');

const app = express();
const PORT = 9117;
const DB_PATH = path.join(__dirname, 'warehouse.db');

// Support large image payloads (base64 encoded strings)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(__dirname));

// Initialize SQLite database
const db = new sqlite3.Database(DB_PATH, (err) => {
  if (err) console.error("Error opening database:", err.message);
  else console.log("Connected to SQLite database at:", DB_PATH);
});

// Create tables
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS tags (
      uid TEXT PRIMARY KEY,
      tagType TEXT,
      tagId TEXT,
      tagRef TEXT,
      areaId TEXT,
      shopId TEXT,
      materialId TEXT,
      description TEXT,
      defaultColor INTEGER,
      defaultBeep INTEGER,
      defaultFlash INTEGER,
      parentTag TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS skus (
      skuNo TEXT PRIMARY KEY,
      itemLabel TEXT,
      description TEXT,
      supplierCustomer TEXT,
      tagBind TEXT,
      dateAdded TEXT,
      productImage TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  // Inventory stock table
  db.run(`
    CREATE TABLE IF NOT EXISTS inventory (
      skuNo TEXT PRIMARY KEY,
      stock INTEGER DEFAULT 0,
      lastUpdated TEXT
    )
  `);

  // Stock transactions history table
  db.run(`
    CREATE TABLE IF NOT EXISTS stock_transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      orderNo TEXT,
      picklistNo TEXT,
      skuNo TEXT,
      itemLabel TEXT,
      description TEXT,
      supplierCustomer TEXT,
      quantity INTEGER,
      timestamp TEXT,
      productImage TEXT
    )
  `);

  // Running numbers sequence tracking table
  db.run(`
    CREATE TABLE IF NOT EXISTS running_numbers (
      key TEXT PRIMARY KEY,
      seq INTEGER DEFAULT 1000
    )
  `);

  // Picklists / Putaway Lists table
  db.run(`
    CREATE TABLE IF NOT EXISTS picklists (
      uid TEXT PRIMARY KEY,
      type TEXT,
      orderNo TEXT,
      listNo TEXT,
      status TEXT,
      color INTEGER,
      itemsJson TEXT,
      createdAt TEXT,
      activatedAt TEXT,
      completedAt TEXT
    )
  `);
  db.run(`
    CREATE TABLE IF NOT EXISTS picklist_templates (
      uid TEXT PRIMARY KEY,
      name TEXT,
      type TEXT,
      itemsJson TEXT,
      createdAt TEXT
    )
  `);
});

// Helper: Auto-increment running Order Number and Picklist/Putaway (GRN) Number, by list type
function getNextRunningNumbersForType(listType, callback) {
  const isPutaway = listType === 'PUTAWAY';
  const listKey = isPutaway ? 'grn' : 'picklist';
  const listPrefix = isPutaway ? 'GRN' : 'PKL';
  const listSeedStart = isPutaway ? 8001 : 5001;

  db.serialize(() => {
    db.run("INSERT OR IGNORE INTO running_numbers (key, seq) VALUES ('order', 1001)");
    db.run(`INSERT OR IGNORE INTO running_numbers (key, seq) VALUES ('${listKey}', ${listSeedStart})`);

    db.get("SELECT seq FROM running_numbers WHERE key = 'order'", (err, orderRow) => {
      if (err) return callback(err);
      db.get(`SELECT seq FROM running_numbers WHERE key = '${listKey}'`, (err, listRow) => {
        if (err) return callback(err);

        const orderSeq = orderRow ? orderRow.seq : 1001;
        const listSeq = listRow ? listRow.seq : listSeedStart;

        const orderNo = `ORD-${orderSeq}`;
        const listNo = `${listPrefix}-${listSeq}`;

        db.run("UPDATE running_numbers SET seq = seq + 1 WHERE key = 'order'");
        db.run(`UPDATE running_numbers SET seq = seq + 1 WHERE key = '${listKey}'`);

        callback(null, orderNo, listNo);
      });
    });
  });
}

// Helper: Auto-increment running Order Number and PickList Number
function getNextRunningNumbers(callback) {
  db.serialize(() => {
    db.run("INSERT OR IGNORE INTO running_numbers (key, seq) VALUES ('order', 1001)");
    db.run("INSERT OR IGNORE INTO running_numbers (key, seq) VALUES ('picklist', 5001)");

    db.get("SELECT seq FROM running_numbers WHERE key = 'order'", (err, orderRow) => {
      if (err) return callback(err);
      db.get("SELECT seq FROM running_numbers WHERE key = 'picklist'", (err, picklistRow) => {
        if (err) return callback(err);

        const orderSeq = orderRow ? orderRow.seq : 1001;
        const picklistSeq = picklistRow ? picklistRow.seq : 5001;

        const orderNo = `ORD-${orderSeq}`;
        const picklistNo = `PKL-${picklistSeq}`;

        db.run("UPDATE running_numbers SET seq = seq + 1 WHERE key = 'order'");
        db.run("UPDATE running_numbers SET seq = seq + 1 WHERE key = 'picklist'");

        callback(null, orderNo, picklistNo);
      });
    });
  });
}

// ---------------- Server-Side MQTT Client State ----------------
let mqttClient = null;
let apTrafficSeen = false;
let mqttStatus = {
  connected: false,
  connecting: false,
  lastError: null,
  config: {
    host: '192.168.3.81',
    port: '8083',
    wsPath: '/mqtt',
    clientId: 'SmartLightServer',
    username: 'test',
    password: '123456',
    subTopic: '#'
  }
};

let apInfo = {};
let messageLogs = {
  published: [],
  received: []
};

const CODE_NAMES = { "01":"ApInfor", "02":"ApHeartbeat", "03":"TaskResponse", "04":"TaskResult", "131":"TagCommand", "132":"GroupControl" };

function pushLog(type, item) {
  const list = messageLogs[type];
  list.unshift(item);
  if (list.length > 50) list.pop();
}

function nowStamp(){
  const d = new Date();
  const p = (n,l=2)=>String(n).padStart(l,'0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(),3)}`;
}

// Function to connect to MQTT Broker on Server
function connectMqttServer(configParams = {}) {
  mqttStatus.config = { ...mqttStatus.config, ...configParams };
  const { host, port, wsPath, clientId, username, password, subTopic } = mqttStatus.config;

  if (mqttClient) {
    try { mqttClient.end(true); } catch(e){}
    mqttClient = null;
  }

  mqttStatus.connecting = true;
  mqttStatus.connected = false;
  mqttStatus.lastError = null;

  const cleanHost = (host || '').replace(/^mqtts?:\/\//i, '').replace(/\/+$/, '');
  const cleanPath = wsPath ? (wsPath.startsWith('/') ? wsPath : '/' + wsPath) : '/mqtt';
  
  const brokerUrl = port === '8083' || port === '8084' 
    ? `ws://${cleanHost}:${port}${cleanPath}`
    : `mqtt://${cleanHost}:${port || 1883}`;

  console.log(`[MQTT Server] Connecting to broker at ${brokerUrl}...`);

  try {
    mqttClient = mqtt.connect(brokerUrl, {
      clientId: clientId || 'SmartLightServer_' + Math.random().toString(16).substring(2, 6),
      username: username || '',
      password: password || '',
      keepalive: 60,
      clean: true,
      connectTimeout: 5000,
      reconnectPeriod: 3000
    });
  } catch(err) {
    mqttStatus.connecting = false;
    mqttStatus.connected = false;
    mqttStatus.lastError = err.message;
    console.error("[MQTT Server] Setup error:", err.message);
    return;
  }

  mqttClient.on('connect', () => {
    mqttStatus.connected = true;
    mqttStatus.connecting = false;
    mqttStatus.lastError = null;
    console.log(`[MQTT Server] Connected successfully to ${brokerUrl}`);

    const topicToSub = subTopic || '#';
    mqttClient.subscribe(topicToSub, (err) => {
      if (err) console.warn("[MQTT Server] Subscribe warning:", err.message);
      else console.log(`[MQTT Server] Subscribed to topic: ${topicToSub}`);
    });

    db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('mqtt_connected_state', 'true')");
  });

  mqttClient.on('message', (topic, payload) => {
    apTrafficSeen = true;
    let data;
    const strPayload = payload.toString();
    try { data = JSON.parse(strPayload); } catch(e) { data = strPayload; }

    const code = (data && typeof data === 'object' && (data.Code ?? data.code) !== undefined)
      ? String(data.Code ?? data.code).padStart(2,'0') : '--';
    const name = CODE_NAMES[code] || `Code ${code}`;

    if ((name === 'ApInfor' || topic.includes('AP') || code === '01' || code === '02') && typeof data === 'object') {
      apInfo = {
        ID: data.ID ?? data.apId ?? apInfo.ID,
        IP: data.IP ?? data.apIp ?? apInfo.IP,
        MAC: data.MAC ?? data.apMac ?? apInfo.MAC,
        Firmware: data.Firmware ?? data.firmware ?? apInfo.Firmware
      };
    }

    pushLog('received', { time: nowStamp(), code, name, topic, data });
  });

  mqttClient.on('error', (err) => {
    mqttStatus.lastError = err.message;
    console.error("[MQTT Server] Error:", err.message);
  });

  mqttClient.on('close', () => {
    if (mqttStatus.connected) {
      console.log("[MQTT Server] Connection closed.");
    }
    mqttStatus.connected = false;
    mqttStatus.connecting = false;
  });
}

function disconnectMqttServer() {
  if (mqttClient) {
    try { mqttClient.end(true); } catch(e){}
    mqttClient = null;
  }
  mqttStatus.connected = false;
  mqttStatus.connecting = false;
  apTrafficSeen = false;
  db.run("INSERT OR REPLACE INTO settings (key, value) VALUES ('mqtt_connected_state', 'false')");
  console.log("[MQTT Server] Disconnected from broker.");
}

// Proactively check DB and Auto-Connect on Server Startup
db.all("SELECT * FROM settings", [], (err, rows) => {
  if (err) return;
  const settings = {};
  if (rows) rows.forEach(r => { settings[r.key] = r.value; });

  if (settings.mqtt_host) mqttStatus.config.host = settings.mqtt_host;
  if (settings.mqtt_port) mqttStatus.config.port = settings.mqtt_port;
  if (settings.mqtt_wsPath) mqttStatus.config.wsPath = settings.mqtt_wsPath;
  if (settings.mqtt_clientId) mqttStatus.config.clientId = settings.mqtt_clientId;
  if (settings.mqtt_username) mqttStatus.config.username = settings.mqtt_username;
  if (settings.mqtt_password) mqttStatus.config.password = settings.mqtt_password;
  if (settings.mqtt_subTopic) mqttStatus.config.subTopic = settings.mqtt_subTopic;

  if (settings.mqtt_connected_state !== 'false') {
    connectMqttServer();
  }
});

// ---------------- REST API ROUTES FOR MQTT ----------------

// GET /api/mqtt/status
app.get('/api/mqtt/status', (req, res) => {
  res.json({
    connected: mqttStatus.connected,
    connecting: mqttStatus.connecting,
    lastError: mqttStatus.lastError,
    config: mqttStatus.config,
    apInfo: apInfo,
    apTrafficSeen: apTrafficSeen,
    logs: messageLogs
  });
});

// POST /api/mqtt/connect
app.post('/api/mqtt/connect', (req, res) => {
  const config = req.body || {};
  Object.entries(config).forEach(([key, val]) => {
    db.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [`mqtt_${key}`, String(val || '')]);
  });
  connectMqttServer(config);
  res.json({ success: true, status: mqttStatus });
});

// POST /api/mqtt/disconnect
app.post('/api/mqtt/disconnect', (req, res) => {
  disconnectMqttServer();
  res.json({ success: true });
});

// POST /api/mqtt/publish
app.post('/api/mqtt/publish', (req, res) => {
  const { topic, payload } = req.body;
  if (!topic) return res.status(400).json({ error: "Topic is required" });
  if (!mqttClient || !mqttStatus.connected) {
    return res.status(503).json({ error: "Server is not connected to MQTT Broker" });
  }

  const strPayload = typeof payload === 'string' ? payload : JSON.stringify(payload);
  mqttClient.publish(topic, strPayload, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    
    let parsedData = payload;
    if (typeof payload === 'string') {
      try { parsedData = JSON.parse(payload); } catch(e){}
    }
    const code = (parsedData && typeof parsedData === 'object' && (parsedData.Code ?? parsedData.code) !== undefined)
      ? String(parsedData.Code ?? parsedData.code).padStart(2,'0') : '--';
    const name = CODE_NAMES[code] || 'Custom';

    pushLog('published', { time: nowStamp(), code, name, topic, data: parsedData });
    res.json({ success: true });
  });
});

// ---------------- EXISTING REST APIS ----------------

// GET /api/tags
app.get('/api/tags', (req, res) => {
  db.all("SELECT * FROM tags", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const formatted = rows.map(r => ({
      ...r,
      defaultBeep: !!r.defaultBeep,
      defaultFlash: !!r.defaultFlash
    }));
    res.json(formatted);
  });
});

// POST /api/tags
app.post('/api/tags', (req, res) => {
  const tags = req.body;
  if (!Array.isArray(tags)) return res.status(400).json({ error: "Expected an array of tags" });

  db.serialize(() => {
    db.run("DELETE FROM tags");
    const stmt = db.prepare(`
      INSERT INTO tags (uid, tagType, tagId, tagRef, areaId, shopId, materialId, description, defaultColor, defaultBeep, defaultFlash, parentTag)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    tags.forEach(t => {
      stmt.run([
        t.uid, t.tagType, t.tagId, t.tagRef || '', t.areaId || '', t.shopId || '',
        t.materialId || '', t.description || '', t.defaultColor || 0,
        t.defaultBeep ? 1 : 0, t.defaultFlash ? 1 : 0, t.parentTag || ''
      ]);
    });

    stmt.finalize((err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, count: tags.length });
    });
  });
});

// GET /api/skus
app.get('/api/skus', (req, res) => {
  db.all("SELECT * FROM skus", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// POST /api/skus
app.post('/api/skus', (req, res) => {
  const skus = req.body;
  if (!Array.isArray(skus)) return res.status(400).json({ error: "Expected an array of SKUs" });

  db.serialize(() => {
    db.run("DELETE FROM skus");
    const stmt = db.prepare(`
      INSERT INTO skus (skuNo, itemLabel, description, supplierCustomer, tagBind, dateAdded, productImage)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    skus.forEach(s => {
      stmt.run([
        s.skuNo, s.itemLabel || '', s.description || '', s.supplierCustomer || '',
        s.tagBind || '', s.dateAdded || '', s.productImage || ''
      ]);
    });

    stmt.finalize((err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, count: skus.length });
    });
  });
});

// GET /api/settings
app.get('/api/settings', (req, res) => {
  db.all("SELECT * FROM settings", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const settings = {};
    rows.forEach(r => { settings[r.key] = r.value; });
    res.json(settings);
  });
});

// POST /api/settings
app.post('/api/settings', (req, res) => {
  const { key, value } = req.body;
  if (!key) return res.status(400).json({ error: "Key is required" });

  db.run("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)", [key, value || ''], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// DELETE /api/settings/:key
app.delete('/api/settings/:key', (req, res) => {
  db.run("DELETE FROM settings WHERE key = ?", [req.params.key], function(err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ success: true });
  });
});

// ---------------- REST API ROUTES FOR INVENTORY & STOCK TRANSACTIONS ----------------

// GET /api/inventory - Merges all configured SKUs with SQLite inventory stock counts
app.get('/api/inventory', (req, res) => {
  const query = `
    SELECT 
      s.skuNo, s.itemLabel, s.description, s.supplierCustomer, 
      s.tagBind, s.dateAdded, s.productImage,
      COALESCE(i.stock, 0) AS stock,
      i.lastUpdated
    FROM skus s
    LEFT JOIN inventory i ON s.skuNo = i.skuNo
  `;
  db.all(query, [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// POST /api/inventory/adjust - Single Stock addition/subtraction
app.post('/api/inventory/adjust', (req, res) => {
  const { skuNo, quantityDelta } = req.body;
  if (!skuNo || quantityDelta === undefined || isNaN(quantityDelta)) {
    return res.status(400).json({ error: "Invalid parameters. skuNo and quantityDelta are required." });
  }

  const delta = parseInt(quantityDelta, 10);
  if (delta === 0) return res.status(400).json({ error: "Quantity change cannot be zero." });

  db.get("SELECT * FROM skus WHERE skuNo = ?", [skuNo], (err, skuItem) => {
    if (err || !skuItem) return res.status(404).json({ error: "SKU not found in Warehouse Database." });

    getNextRunningNumbers((err, orderNo, picklistNo) => {
      if (err) return res.status(500).json({ error: "Failed to generate running transaction numbers." });

      const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);

      db.serialize(() => {
        db.run(`
          INSERT INTO inventory (skuNo, stock, lastUpdated) 
          VALUES (?, ?, ?)
          ON CONFLICT(skuNo) DO UPDATE SET 
            stock = stock + excluded.stock,
            lastUpdated = excluded.lastUpdated
        `, [skuNo, delta, timestamp]);

        const stmt = db.prepare(`
          INSERT INTO stock_transactions 
          (orderNo, picklistNo, skuNo, itemLabel, description, supplierCustomer, quantity, timestamp, productImage)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        stmt.run([
          orderNo,
          picklistNo,
          skuNo,
          skuItem.itemLabel || '',
          skuItem.description || '',
          skuItem.supplierCustomer || '',
          delta,
          timestamp,
          skuItem.productImage || ''
        ], function(err) {
          if (err) return res.status(500).json({ error: err.message });

          db.get("SELECT stock FROM inventory WHERE skuNo = ?", [skuNo], (err, row) => {
            res.json({
              success: true,
              orderNo,
              picklistNo,
              newStock: row ? row.stock : 0,
              delta,
              timestamp
            });
          });
        });
        stmt.finalize();
      });
    });
  });
});

// POST /api/inventory/batch-adjust - Batch stock modification sharing ONE Order & Picklist Number cluster
app.post('/api/inventory/batch-adjust', (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Invalid items array." });
  }

  const validAdjustments = items.filter(i => i.skuNo && !isNaN(i.quantityDelta) && parseInt(i.quantityDelta, 10) !== 0);
  if (validAdjustments.length === 0) {
    return res.status(400).json({ error: "No non-zero stock adjustments provided." });
  }

  const skuNos = validAdjustments.map(i => i.skuNo);
  const placeholders = skuNos.map(() => '?').join(',');

  db.all(`SELECT * FROM skus WHERE skuNo IN (${placeholders})`, skuNos, (err, skuRows) => {
    if (err) return res.status(500).json({ error: err.message });

    const skuMap = {};
    skuRows.forEach(r => { skuMap[r.skuNo] = r; });

    getNextRunningNumbers((err, orderNo, picklistNo) => {
      if (err) return res.status(500).json({ error: "Failed to generate running numbers." });

      const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);

      db.serialize(() => {
        const updateStmt = db.prepare(`
          INSERT INTO inventory (skuNo, stock, lastUpdated) 
          VALUES (?, ?, ?)
          ON CONFLICT(skuNo) DO UPDATE SET 
            stock = stock + excluded.stock,
            lastUpdated = excluded.lastUpdated
        `);

        const txStmt = db.prepare(`
          INSERT INTO stock_transactions 
          (orderNo, picklistNo, skuNo, itemLabel, description, supplierCustomer, quantity, timestamp, productImage)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        validAdjustments.forEach(adj => {
          const delta = parseInt(adj.quantityDelta, 10);
          const skuItem = skuMap[adj.skuNo] || { itemLabel: '', description: '', supplierCustomer: '', productImage: '' };

          updateStmt.run([adj.skuNo, delta, timestamp]);
          txStmt.run([
            orderNo,
            picklistNo,
            adj.skuNo,
            skuItem.itemLabel || '',
            skuItem.description || '',
            skuItem.supplierCustomer || '',
            delta,
            timestamp,
            skuItem.productImage || ''
          ]);
        });

        updateStmt.finalize();
        txStmt.finalize((err) => {
          if (err) return res.status(500).json({ error: err.message });
          res.json({
            success: true,
            orderNo,
            picklistNo,
            count: validAdjustments.length,
            timestamp
          });
        });
      });
    });
  });
});

// GET /api/transactions - Returns all Stock Transaction History records
app.get('/api/transactions', (req, res) => {
  db.all("SELECT * FROM stock_transactions ORDER BY id DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// GET /api/running-numbers/next?listType=PICKLIST|PUTAWAY - Preview next Order + Picklist/GRN number (does NOT reserve until list is saved)
app.get('/api/running-numbers/next', (req, res) => {
  const listType = req.query.listType === 'PUTAWAY' ? 'PUTAWAY' : 'PICKLIST';
  getNextRunningNumbersForType(listType, (err, orderNo, listNo) => {
    if (err) return res.status(500).json({ error: "Failed to generate running numbers." });
    res.json({ orderNo, listNo });
  });
});

// GET /api/picklists - Returns all saved Picklists / Putaway Lists
app.get('/api/picklists', (req, res) => {
  db.all("SELECT * FROM picklists ORDER BY createdAt DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    const parsed = rows.map(r => ({
      uid: r.uid,
      type: r.type,
      orderNo: r.orderNo,
      listNo: r.listNo,
      status: r.status,
      color: r.color,
      items: JSON.parse(r.itemsJson || '[]'),
      createdAt: r.createdAt,
      activatedAt: r.activatedAt,
      completedAt: r.completedAt
    }));
    res.json(parsed);
  });
});

// POST /api/picklists - Replace all Picklists / Putaway Lists (mirrors tags/skus full-array save pattern)
app.post('/api/picklists', (req, res) => {
  const lists = req.body;
  if (!Array.isArray(lists)) return res.status(400).json({ error: "Expected an array of lists" });

  db.serialize(() => {
    db.run("DELETE FROM picklists");
    const stmt = db.prepare(`
      INSERT INTO picklists (uid, type, orderNo, listNo, status, color, itemsJson, createdAt, activatedAt, completedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    lists.forEach(l => {
      stmt.run([
        l.uid, l.type || 'PICKLIST', l.orderNo || '', l.listNo || '', l.status || 'PENDING',
        l.color ?? null, JSON.stringify(l.items || []), l.createdAt || '', l.activatedAt || '', l.completedAt || ''
      ]);
    });

    stmt.finalize((err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, count: lists.length });
    });
  });

});

// GET /api/picklist-templates - Returns saved Picklist / Putaway templates
app.get('/api/picklist-templates', (req, res) => {
  db.all("SELECT * FROM picklist_templates ORDER BY createdAt DESC", [], (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows.map(r => ({
      uid: r.uid,
      name: r.name,
      type: r.type,
      items: JSON.parse(r.itemsJson || '[]'),
      createdAt: r.createdAt
    })));
  });
});

// POST /api/picklist-templates - Replace all saved templates
app.post('/api/picklist-templates', (req, res) => {
  const templates = req.body;
  if (!Array.isArray(templates)) return res.status(400).json({ error: "Expected an array of templates" });
  db.serialize(() => {
    db.run("DELETE FROM picklist_templates");
    const stmt = db.prepare("INSERT INTO picklist_templates (uid, name, type, itemsJson, createdAt) VALUES (?, ?, ?, ?, ?)");
    templates.forEach(t => stmt.run([t.uid, t.name || t.listNo || '', t.type || 'PICKLIST', JSON.stringify(t.items || []), t.createdAt || '']));
    stmt.finalize(err => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ success: true, count: templates.length });
    });
  });
});

// POST /api/inventory/commit-list - Commit a Picklist/Putaway's stock deltas under its OWN existing Order/List numbers
app.post('/api/inventory/commit-list', (req, res) => {
  const { orderNo, listNo, items } = req.body;
  if (!orderNo || !listNo || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "orderNo, listNo, and a non-empty items array are required." });
  }

  const validAdjustments = items.filter(i => i.skuNo && !isNaN(i.quantityDelta) && parseInt(i.quantityDelta, 10) !== 0);
  if (validAdjustments.length === 0) {
    return res.status(400).json({ error: "No non-zero stock adjustments provided." });
  }

  const skuNos = validAdjustments.map(i => i.skuNo);
  const placeholders = skuNos.map(() => '?').join(',');

  db.all(`SELECT * FROM skus WHERE skuNo IN (${placeholders})`, skuNos, (err, skuRows) => {
    if (err) return res.status(500).json({ error: err.message });

    const skuMap = {};
    skuRows.forEach(r => { skuMap[r.skuNo] = r; });

    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);

    db.serialize(() => {
      const updateStmt = db.prepare(`
        INSERT INTO inventory (skuNo, stock, lastUpdated) 
        VALUES (?, ?, ?)
        ON CONFLICT(skuNo) DO UPDATE SET 
          stock = stock + excluded.stock,
          lastUpdated = excluded.lastUpdated
      `);

      const txStmt = db.prepare(`
        INSERT INTO stock_transactions 
        (orderNo, picklistNo, skuNo, itemLabel, description, supplierCustomer, quantity, timestamp, productImage)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      validAdjustments.forEach(adj => {
        const delta = parseInt(adj.quantityDelta, 10);
        const skuItem = skuMap[adj.skuNo] || { itemLabel: '', description: '', supplierCustomer: '', productImage: '' };

        updateStmt.run([adj.skuNo, delta, timestamp]);
        txStmt.run([
          orderNo,
          listNo,
          adj.skuNo,
          skuItem.itemLabel || '',
          skuItem.description || '',
          skuItem.supplierCustomer || '',
          delta,
          timestamp,
          skuItem.productImage || ''
        ]);
      });

      updateStmt.finalize();
      txStmt.finalize((err) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ success: true, orderNo, listNo, count: validAdjustments.length, timestamp });
      });
    });
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n==================================================`);
  console.log(`Smart Light Host Automation Service running on port ${PORT}`);
  console.log(`Local/External Access: http://<server-ip>:${PORT}`);
  console.log(`==================================================\n`);
});