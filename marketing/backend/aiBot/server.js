/**
 * Production-Ready Advanced Node.js Backend for Meena Marketing
 * 
 * Features:
 * 1. API Key Load Balancer (Round Robin) to bypass rate limits silently.
 * 2. In-Memory Firestore Snapshot (Zero-read latency for thousands of products).
 * 3. Pure Text-Chat Mode (Highly optimized REST API using gemini-3.5-flash-lite).
 * 4. Automatic Context Injection (System Prompt + History) for seamless key swaps.
 * 5. Advanced Auto-Failover: Automatically retries the next API key on 429/500 errors.
 * 6. Dynamic Context Limiting: Safely clamps history to 20 messages on the server side.
 * 7. Fast-Inference Dual-Persona Sales Engine with Tanglish & Stock Enforcement.
 * 8. Real-Time System Dashboard with Extended Day/Hour Uptime Tracking.
 * 9. Smart Key Pool: 1-Minute Cooldowns for Rate Limits & 10-Minute Cooldowns for 403/404.
 * 10. In-Band Notice Injection: Alerts users directly in chat if a failover occurred.
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const admin = require('firebase-admin');
const cors = require('cors');

// ============================================================================
// CONFIGURATION: AI MODELS (Edit here to change models globally)
// ============================================================================
const CHAT_MODEL = "gemini-3.5-flash-lite"; // Highly efficient model for text REST API

// ============================================================================
// 1. FIREBASE ADMIN & IN-MEMORY CACHE INITIALIZATION
// ============================================================================
const serviceAccountRaw = process.env.FIREBASE_SERVICE_ACCOUNT;
if (!serviceAccountRaw) {
    console.error("CRITICAL: FIREBASE_SERVICE_ACCOUNT environment variable is missing.");
    process.exit(1);
}

const serviceAccount = JSON.parse(serviceAccountRaw);
// Handle escaped newlines properly from Hugging Face Secrets
if (serviceAccount.private_key) {
    serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
}

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();
let inventoryMemory = [];

// Persistent zero-cost listener: Keeps backend RAM perfectly synced with Firestore
db.collection('inventory').onSnapshot((snapshot) => {
    inventoryMemory = snapshot.docs.map(doc => {
        const d = doc.data();
        return {
            name: d.name || 'Unknown',
            model: d.model || 'N/A',
            qty: d.qty || 0,
            price: d.price || 0 // Included price to ensure AI can answer pricing queries
        };
    });
    console.log(`[Firestore Sync] Inventory memory refreshed: ${inventoryMemory.length} products loaded.`);
}, (error) => {
    console.error("Firestore snapshot error:", error);
});

// ============================================================================
// 2. SMART API KEY LOAD BALANCER & PROMPT GENERATOR
// ============================================================================
const rawKeys = (process.env.GEMINI_API_KEYS || "").split(',').map(k => k.trim()).filter(Boolean);

// Key state tracker
const keyPool = rawKeys.map((key, i) => ({
    id: i + 1,
    key,
    status: "HEALTHY", // 'HEALTHY' | 'RATE_LIMITED' | 'DEPRECATED'
    disabledUntil: 0,
    deadReason: null
}));

let currentKeyIndex = 0;

// Finds the next healthy, non-cooling-down key
function getNextKey() {
    if (keyPool.length === 0) throw new Error("No Gemini API keys configured.");

    const now = Date.now();
    for (let i = 0; i < keyPool.length; i++) {
        const index = (currentKeyIndex + i) % keyPool.length;
        const entry = keyPool[index];

        // Auto-release deprecated keys after 10 minutes (600,000 ms) to re-test and re-alert
        if (entry.status === "DEPRECATED" && now >= entry.disabledUntil) {
            entry.status = "HEALTHY";
            entry.deadReason = null;
            console.log(`[Load Balancer] Key #${entry.id} deprecation lock expired (10m). Restored to HEALTHY for re-testing.`);
        }

        // Skip keys that are currently in their 10-minute deprecated cooldown
        if (entry.status === "DEPRECATED") continue;

        // Auto-release rate-limited keys after 60 seconds
        if (entry.status === "RATE_LIMITED" && now >= entry.disabledUntil) {
            entry.status = "HEALTHY";
            console.log(`[Load Balancer] Key #${entry.id} rate-limit window expired. Restored to HEALTHY.`);
        }

        if (entry.status === "HEALTHY") {
            currentKeyIndex = (index + 1) % keyPool.length;
            console.log(`[Load Balancer] Routing traffic to Key Pool Index: ${index}`);
            return entry;
        }
    }

    return null; // All keys are either locked or dead
}

// Quarantine a key for 60 seconds
function markKeyRateLimited(entry, durationMs = 60000) {
    entry.status = "RATE_LIMITED";
    entry.disabledUntil = Date.now() + durationMs;
    console.warn(`[Load Balancer] Key #${entry.id} rate limited. Locked for ${durationMs / 1000}s.`);
}

// Temporarily retire a key for 10 minutes (404, 403, revoked, etc.)
function markKeyDeprecated(entry, reason, durationMs = 600000) {
    entry.status = "DEPRECATED";
    entry.deadReason = reason;
    entry.disabledUntil = Date.now() + durationMs; // Locks for exactly 10 minutes
    console.error(`[Load Balancer] Key #${entry.id} TEMPORARILY RETIRED (10 mins): ${reason}`);
}

function getSystemPrompt() {
    // Compressed pipe-delimited format to minimize prompt tokens
    const inventoryText = inventoryMemory
        .map(item => `${item.name} | ${item.model} | Qty:${item.qty} | ₹${item.price}`)
        .join('\n');

    // High-speed, token-optimized system prompt (Fast inference, no lag, strict rules)
    return `Role: AI Manager & Sales Executive for Meena Marketing (Electronics, Furniture, Mobiles).
Audience: Customers (Sales/Support) or Owner (Inventory/Totals).

STRICT OPERATING RULES:
1. Language: Tanglish (Spoken Tamil + English). Use "இருக்கு", "இல்லங்க", "வாங்க", "சொல்லுங்க".
2. Banned Formal Tamil: Strictly avoid ancient/formal words ("உள்ளது", "இல்லை", "வருக", "கூறுக", "கிடைக்கப்பெறும்").
3. Respect: Always add "ங்க". NEVER guess Sir/Madam.
4. Business Terms: Keep in English (Stock, Price, Model, Offer, Bill, Warranty, Brand).
5. Stock Display: NEVER say "Qty" in your chat responses. Always say "Stock" (e.g., say "Stock 5 இருக்கு", DO NOT say "Qty 5").
6. Cross-Selling Pivot: If Qty is 0, say "இது இப்போ ஸ்டாக் இல்லங்க, ஆனா..." and recommend the closest alternative from inventory.
7. Zero Hallucination: ONLY use items in the inventory list. Do not invent products or discounts. Accurately calculate totals for the Owner.

CURRENT STORE INVENTORY (Name | Model | Qty | Selling Price):
${inventoryText}`;
}

// ============================================================================
// 3. SERVER SETUP & REST API (TEXT CHAT MODE)
// ============================================================================
const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);

// ----------------------------------------------------------------------------
// Visual Professional Dark Mode Status Dashboard (System Online Interface)
// ----------------------------------------------------------------------------
app.get('/api/status', (req, res) => {
    res.json({
        status: "ONLINE",
        uptimeSeconds: Math.floor(process.uptime()),
        inventoryCount: inventoryMemory.length,
        keyPoolSize: keyPool.length,
        keyPoolDetails: keyPool.map(k => ({
            id: k.id,
            status: k.status,
            disabledUntil: k.disabledUntil > Date.now() ? `${Math.ceil((k.disabledUntil - Date.now()) / 1000)}s remaining` : null,
            deadReason: k.deadReason
        })),
        currentKeyIndex: currentKeyIndex,
        chatModel: CHAT_MODEL,
        timestamp: new Date().toISOString()
    });
});

app.get('/', (req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Meena Marketing AI • Engine Dashboard</title>
    <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=Inter:wght@400;600;700;800&display=swap" rel="stylesheet">
    <style>
        :root {
            --bg: #070b10;
            --surface: #0e1520;
            --surface-card: #131c2a;
            --border: #1e2d42;
            --border-glow: rgba(16, 185, 129, 0.25);
            --text-main: #f8fafc;
            --text-muted: #94a3b8;
            --emerald: #10b981;
            --emerald-glow: rgba(16, 185, 129, 0.45);
            --meena-red: #ef4444;
            --cyan: #06b6d4;
            --amber: #f59e0b;
        }

        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            background-color: var(--bg);
            color: var(--text-main);
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            overflow-x: hidden;
            background-image: 
                radial-gradient(circle at 50% 0%, rgba(13, 148, 136, 0.12) 0%, transparent 60%),
                radial-gradient(circle at 100% 100%, rgba(16, 185, 129, 0.05) 0%, transparent 40%);
        }

        .container {
            max-width: 1080px;
            margin: 0 auto;
            padding: 40px 24px;
            width: 100%;
        }

        /* Top Brand Header */
        header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px solid var(--border);
            padding-bottom: 24px;
            margin-bottom: 36px;
        }

        .brand {
            display: flex;
            flex-direction: column;
            gap: 4px;
        }

        .brand-title {
            font-size: 1.5rem;
            font-weight: 800;
            letter-spacing: -0.02em;
        }

        .brand-title span.meena { color: var(--meena-red); }
        .brand-title span.mkt { color: #ffffff; }

        .brand-sub {
            font-family: 'JetBrains Mono', monospace;
            font-size: 0.78rem;
            color: var(--cyan);
            letter-spacing: 1px;
            text-transform: uppercase;
        }

        /* Core Live Status Pill */
        .system-badge {
            display: inline-flex;
            align-items: center;
            gap: 12px;
            background: rgba(16, 185, 129, 0.08);
            border: 1px solid var(--emerald);
            padding: 10px 20px;
            border-radius: 9999px;
            box-shadow: 0 0 20px var(--emerald-glow);
        }

        .pulse-orb {
            width: 12px;
            height: 12px;
            background: var(--emerald);
            border-radius: 50%;
            position: relative;
            box-shadow: 0 0 10px var(--emerald);
        }

        .pulse-orb::after {
            content: '';
            position: absolute;
            top: -4px;
            left: -4px;
            width: 20px;
            height: 20px;
            border-radius: 50%;
            border: 2px solid var(--emerald);
            animation: radarPulse 1.8s infinite cubic-bezier(0.2, 0.8, 0.2, 1);
        }

        @keyframes radarPulse {
            0% { transform: scale(0.6); opacity: 1; }
            100% { transform: scale(2.2); opacity: 0; }
        }

        .system-badge span.status-txt {
            font-family: 'JetBrains Mono', monospace;
            font-size: 0.88rem;
            font-weight: 700;
            color: #ffffff;
            letter-spacing: 1.5px;
        }

        /* Metrics Grid */
        .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
            gap: 20px;
            margin-bottom: 32px;
        }

        .card {
            background: var(--surface-card);
            border: 1px solid var(--border);
            border-radius: 16px;
            padding: 24px;
            position: relative;
            overflow: hidden;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
            transition: border-color 0.25s, transform 0.25s;
        }

        .card:hover {
            border-color: rgba(6, 182, 212, 0.4);
            transform: translateY(-2px);
        }

        .card-label {
            font-size: 0.8rem;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: var(--text-muted);
            margin-bottom: 8px;
            font-weight: 600;
        }

        .card-value {
            font-family: 'JetBrains Mono', monospace;
            font-size: 2.1rem;
            font-weight: 700;
            color: #ffffff;
            line-height: 1.1;
        }

        .card-sub {
            margin-top: 8px;
            font-size: 0.8rem;
            color: var(--emerald);
            display: flex;
            align-items: center;
            gap: 6px;
        }

        /* Visual Endpoints Section */
        .panel {
            background: var(--surface);
            border: 1px solid var(--border);
            border-radius: 18px;
            padding: 28px;
            margin-bottom: 32px;
            box-shadow: 0 12px 30px rgba(0,0,0,0.5);
        }

        .panel-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 20px;
        }

        .panel-title {
            font-size: 1.05rem;
            font-weight: 700;
            letter-spacing: -0.01em;
            color: #ffffff;
        }

        .endpoint-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 16px 20px;
            background: rgba(255, 255, 255, 0.02);
            border: 1px solid var(--border);
            border-radius: 12px;
            margin-bottom: 12px;
            font-family: 'JetBrains Mono', monospace;
            font-size: 0.88rem;
        }

        .endpoint-row:last-child { margin-bottom: 0; }

        .method {
            padding: 4px 10px;
            border-radius: 6px;
            font-weight: 700;
            font-size: 0.75rem;
        }

        .method.post { background: rgba(6, 182, 212, 0.15); color: var(--cyan); border: 1px solid rgba(6, 182, 212, 0.3); }

        .endpoint-tag {
            color: var(--text-muted);
            font-size: 0.8rem;
        }

        .state-chip {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            color: var(--emerald);
            font-weight: 600;
            font-size: 0.78rem;
        }

        .state-chip::before {
            content: '';
            width: 7px;
            height: 7px;
            background: var(--emerald);
            border-radius: 50%;
        }

        /* Footer */
        footer {
            border-top: 1px solid var(--border);
            padding: 20px 24px;
            text-align: center;
            font-size: 0.8rem;
            color: var(--text-muted);
            font-family: 'JetBrains Mono', monospace;
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <div class="brand">
                <div class="brand-title"><span class="meena">Meena</span> <span class="mkt">Marketing</span></div>
                <div class="brand-sub">AI Text Chat Engine v3.0</div>
            </div>
            <div class="system-badge">
                <div class="pulse-orb"></div>
                <span class="status-txt">SYSTEM ONLINE</span>
            </div>
        </header>

        <div class="stats-grid">
            <div class="card">
                <div class="card-label">Cached Products (RAM)</div>
                <div class="card-value" id="valInvCount">${inventoryMemory.length}</div>
                <div class="card-sub">● Zero-Read Real-Time Cache</div>
            </div>
            <div class="card">
                <div class="card-label">Key Pool Capacity</div>
                <div class="card-value" id="valKeyPool">${keyPool.length}</div>
                <div class="card-sub">● Advanced Auto-Failover</div>
            </div>
            <div class="card">
                <div class="card-label">Active Engine</div>
                <div class="card-value" style="font-size: 1.45rem; padding-top: 6px;">Chat Architecture</div>
                <div class="card-sub" style="color: var(--cyan); display: flex; flex-direction: column; align-items: flex-start;">
                    <span>● Engine: ${CHAT_MODEL}</span>
                </div>
            </div>
            <div class="card">
                <div class="card-label">Server Uptime</div>
                <div class="card-value" id="valUptime">0s</div>
                <div class="card-sub" style="color: var(--amber);">● Continuous Gateway Active</div>
            </div>
        </div>

        <div class="panel">
            <div class="panel-header">
                <div class="panel-title">Production Gateway Endpoints</div>
            </div>

            <div class="endpoint-row">
                <div style="display: flex; align-items: center; gap: 14px;">
                    <span class="method post">POST</span>
                    <span>/chat</span>
                    <span class="endpoint-tag">(Text Typing via ${CHAT_MODEL})</span>
                </div>
                <div class="state-chip">HEALTHY</div>
            </div>
        </div>
    </div>

    <footer>
        Meena Marketing Enterprise • Production Gateway Node • All Systems Operational
    </footer>

    <script>
        async function refreshStats() {
            try {
                const res = await fetch('/api/status');
                if (!res.ok) return;
                const data = await res.json();
                
                document.getElementById('valInvCount').innerText = data.inventoryCount;
                document.getElementById('valKeyPool').innerText = data.keyPoolSize;

                // Precision multi-day uptime calculator
                const days = Math.floor(data.uptimeSeconds / 86400);
                const hrs = Math.floor((data.uptimeSeconds % 86400) / 3600);
                const mins = Math.floor((data.uptimeSeconds % 3600) / 60);
                const secs = data.uptimeSeconds % 60;

                let uptimeDisplay = '';
                if (days > 0) uptimeDisplay += days + 'd ';
                if (hrs > 0 || days > 0) uptimeDisplay += hrs + 'h ';
                uptimeDisplay += mins + 'm ' + secs + 's';

                document.getElementById('valUptime').innerText = uptimeDisplay;
            } catch(e) {}
        }
        setInterval(refreshStats, 3000);
        refreshStats();
    </script>
</body>
</html>`);
});

// REST Endpoint for Standard Typing/Chat
app.post('/chat', async (req, res) => {
    try {
        const { history = [], message } = req.body;
        
        // Advanced Context Management: Enforce strict 20-message memory limit on the backend
        const safeHistory = history.slice(-20);
        
        const payload = {
            systemInstruction: { parts: [{ text: getSystemPrompt() }] },
            contents: [
                ...safeHistory, 
                { role: "user", parts: [{ text: message }] }
            ]
        };

        const maxAttempts = keyPool.length;
        let finalResponseData = null;
        let finalStatus = 500;
        const keyAlerts = []; // Collects deprecation/error notices during failover

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            const keyEntry = getNextKey();

            if (!keyEntry) {
                console.error("[Load Balancer] No active keys available.");
                return res.status(503).json({ 
                    error: "All keys are temporarily rate-limited or deprecated. Please check server configuration." 
                });
            }

            const url = `https://generativelanguage.googleapis.com/v1beta/models/${CHAT_MODEL}:generateContent?key=${keyEntry.key}`;
            
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                const data = await response.json();
                
                // --- SUCCESS ---
                if (response.ok) {
                    // Prepend any collected failover alerts to the final generated text
                    if (keyAlerts.length > 0 && data.candidates?.[0]?.content?.parts?.[0]?.text) {
                        const alertPrefix = keyAlerts.join("\n") + "\n\n---\n\n";
                        data.candidates[0].content.parts[0].text = alertPrefix + data.candidates[0].content.parts[0].text;
                    }
                    return res.json(data);
                }

                // --- 429: TEMPORARY RATE LIMIT ---
                if (response.status === 429) {
                    markKeyRateLimited(keyEntry, 60000);
                    finalResponseData = data;
                    finalStatus = response.status;
                    continue; 
                }

                // --- 404 / 403: DEPRECATED / INVALID KEY (10 MINUTE LOCK) ---
                if (response.status === 404 || response.status === 403) {
                    const errorDesc = response.status === 404 
                        ? `Key #${keyEntry.id} is deprecated or endpoint not found (HTTP 404)`
                        : `Key #${keyEntry.id} has invalid credentials/permissions (HTTP 403)`;

                    markKeyDeprecated(keyEntry, errorDesc);
                    
                    // Add notice to display with the final answer
                    keyAlerts.push(`⚠️ [System Notice]: ${errorDesc}. Switched to backup key.`);
                    
                    finalResponseData = data;
                    finalStatus = response.status;
                    continue;
                }

                // --- 500+: TRANSIENT SERVER ERROR ---
                if (response.status >= 500) {
                    console.warn(`[Load Balancer] Google 5xx error on Key #${keyEntry.id}. Retrying next key...`);
                    finalResponseData = data;
                    finalStatus = response.status;
                    continue;
                }

                // Client error (e.g. 400 Bad Request) - return without retry
                return res.status(response.status).json(data);

            } catch (fetchError) {
                console.error(`[Load Balancer] Network fetch error on Key #${keyEntry.id}:`, fetchError.message);
                finalResponseData = { error: "Network fetch failed during generation" };
                finalStatus = 500;
            }
        }

        // If loop completes without returning, all configured keys failed
        res.status(finalStatus).json(finalResponseData);

    } catch (error) {
        console.error("[REST Error]", error);
        res.status(500).json({ error: "Failed to generate text response" });
    }
});

// ============================================================================
// 4. BOOT SERVER
// ============================================================================
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
