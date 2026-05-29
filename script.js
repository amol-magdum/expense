// --- CONFIGURATION MANAGEMENT ---
// These placeholders will be automatically overwritten by GitHub Actions during deployment
const CLIENT_ID = 'G_CLIENT_ID_PLACEHOLDER'; 
const API_KEY = 'G_API_KEY_PLACEHOLDER';

const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email';
const FILE_NAME = 'app_expenses.json';

let tokenClient;
let accessToken = null;
let fileId = null;
let localData = { expenses: [] };
let userEmail = "";

// State Machine Initialization Tracker
const now = new Date();
let selectedMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`; // Defaults explicitly to Current System 'YYYY-MM'

// Core Screen Element DOM Maps
const loginScreen = document.getElementById('login-screen');
const appScreen = document.getElementById('app-screen');
const loginBtn = document.getElementById('login-btn');
const logoutBtn = document.getElementById('logout-btn');
const menuBtn = document.getElementById('menu-btn');
const menuPanel = document.getElementById('menu-panel');
const fileStatus = document.getElementById('file-status');
const monthlyTotal = document.getElementById('monthly-total');
const totalCardLabel = document.getElementById('total-card-label');
const tableBody = document.getElementById('expense-table-body');
const expenseForm = document.getElementById('expense-form');
const monthFilterSelect = document.getElementById('month-filter');

// Navigation Interface View Select Elements
const tabLogger = document.getElementById('tab-logger');
const tabSummary = document.getElementById('tab-summary');
const loggerView = document.getElementById('logger-view');
const summaryView = document.getElementById('summary-view');
const summaryTableBody = document.getElementById('summary-table-body');

// Set form default calendar pick date automatically to local system timestamp
document.getElementById('exp-date').value = now.toISOString().split('T')[0];

// --- WINDOW RUNTIME ENTRY INITIALIZATION LIFECYCLE ---
window.onload = function () {
    const savedToken = localStorage.getItem('drive_expense_token');
    const expiry = localStorage.getItem('drive_expense_token_expiry');
    const isSessionValid = savedToken && expiry && Date.now() < parseInt(expiry);
    
    if (isSessionValid) {
        accessToken = savedToken;
    } else {
        localStorage.clear();
    }
    
    gapi.load('client', async () => {
        try {
            await gapi.client.init({ 
                discoveryDocs: ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"] 
            });
            if (isSessionValid) {
                gapi.client.setToken({ access_token: accessToken });
                await launchAppEngine();
            }
        } catch (err) {
            console.error("GAPI initialization error context hook:", err);
            if (isSessionValid) {
                gapi.client.setToken({ access_token: accessToken });
                await launchAppEngine();
            }
        }
    });

    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: CLIENT_ID,
        scope: SCOPES,
        callback: async (resp) => {
            if (resp.error) return;
            accessToken = resp.access_token;
            
            // Fix: Track Google's short-lived token lifespan accurately
            const expiresInSeconds = resp.expires_in ? parseInt(resp.expires_in) : 3600;
            const bufferTimeMs = 5 * 60 * 1000; // 5-minute safety threshold buffer
            const expiryTimestamp = Date.now() + (expiresInSeconds * 1000) - bufferTimeMs;
            
            localStorage.setItem('drive_expense_token', accessToken);
            localStorage.setItem('drive_expense_token_expiry', expiryTimestamp.toString());
            
            gapi.client.setToken({ access_token: accessToken });
            await launchAppEngine();
        }
    });

    loginBtn.onclick = () => tokenClient.requestAccessToken({ prompt: '' });
    logoutBtn.onclick = terminateSession;
    menuBtn.onclick = (e) => {
        e.stopPropagation();
        menuPanel.classList.toggle('hidden');
    };

    document.addEventListener('click', (event) => {
        if (!menuPanel.contains(event.target) && !menuBtn.contains(event.target)) {
            menuPanel.classList.add('hidden');
        }
    });

    monthFilterSelect.onchange = (e) => {
        selectedMonth = e.target.value;
        renderHistoryTableScreen();
    };

    // Tab view switcher click links
    tabLogger.onclick = () => showScreenView('logger');
    tabSummary.onclick = () => showScreenView('summary');
};

// --- MULTI-SCREEN NAVIGATION ENGINE SWITCH ---
function showScreenView(targetView) {
    if (targetView === 'logger') {
        tabLogger.className = "w-1/2 py-2.5 px-4 text-center rounded-lg bg-blue-600 text-white font-semibold text-sm shadow transition duration-150 focus:outline-none";
        tabSummary.className = "w-1/2 py-2.5 px-4 text-center rounded-lg text-gray-500 hover:text-gray-800 font-semibold text-sm transition duration-150 focus:outline-none";
        loggerView.classList.remove('hidden');
        summaryView.classList.add('hidden');
        renderHistoryTableScreen();
    } else {
        tabSummary.className = "w-1/2 py-2.5 px-4 text-center rounded-lg bg-blue-600 text-white font-semibold text-sm shadow transition duration-150 focus:outline-none";
        tabLogger.className = "w-1/2 py-2.5 px-4 text-center rounded-lg text-gray-500 hover:text-gray-800 font-semibold text-sm transition duration-150 focus:outline-none";
        loggerView.classList.add('hidden');
        summaryView.classList.remove('hidden');
        renderMonthlyBreakdownScreen();
    }
}

// --- SYSTEM INGESTION FRAMEWORK BOOTSTRAP ---
async function launchAppEngine() {
    loginScreen.classList.add('hidden');
    appScreen.classList.remove('hidden');
    setTimeout(() => appScreen.classList.remove('opacity-0'), 50);
    
    try {
        const userInfo = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        }).then(res => res.json());
        
        userEmail = userInfo.email;
        document.getElementById('user-email').innerText = `Sync Profile: ${userEmail}`;
        
        await syncDriveCloudFile();
    } catch (err) {
        console.error("User configuration sync error baseline context:", err);
        terminateSession();
    }
}

function terminateSession() {
    localStorage.clear();
    location.reload();
}

// --- CLOUD DATABASING FILE CONTROLS ---
async function syncDriveCloudFile() {
    fileStatus.innerText = "Scanning Drive Storage...";
    try {
        const response = await gapi.client.drive.files.list({
            q: `name = '${FILE_NAME}' and trashed = false`,
            fields: 'files(id, name)',
            spaces: 'drive'
        });

        const files = response.result.files;
        if (files && files.length > 0) {
            fileId = files[0].id;
            fileStatus.innerText = "Cloud Connection Established";
            fileStatus.className = "text-xs font-medium bg-green-50 text-green-800 border border-green-200 px-3 py-1 rounded-full w-fit";
            await readJsonFile();
        } else {
            fileStatus.innerText = "Building Cloud Registry File...";
            await createJsonFile();
        }
    } catch (err) {
        console.error("Cloud lookup fault error registry context:", err);
        fileStatus.innerText = "Database File Error Connection Loss";
        fileStatus.className = "text-xs font-medium bg-red-50 text-red-800 border border-red-200 px-3 py-1 rounded-full w-fit";
    }
}

async function createJsonFile() {
    const boundary = 'foo_bar_baz';
    const delimiter = `\r\n--${boundary}\r\n`;
    const close_delim = `\r\n--${boundary}--`;
    const metadata = { 'name': FILE_NAME, 'mimeType': 'application/json' };
    const data = JSON.stringify({ expenses: [] });

    const multipartRequestBody =
        delimiter + 'Content-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(metadata) +
        delimiter + 'Content-Type: application/json\r\n\r\n' + data + close_delim;

    const response = await gapi.client.request({
        'path': '/upload/drive/v3/files',
        'method': 'POST',
        'params': { 'uploadType': 'multipart' },
        'headers': { 'Content-Type': `multipart/related; boundary="${boundary}"` },
        'body': multipartRequestBody
    });

    fileId = response.result.id;
    localData = { expenses: [] };
    populateMonthFiltersEngine();
    renderHistoryTableScreen();
}

async function readJsonFile() {
    try {
        const response = await gapi.client.drive.files.get({ fileId: fileId, alt: 'media' });
        localData = response.result || { expenses: [] };
        if (typeof localData === 'string') {
            localData = JSON.parse(localData);
        }
        populateMonthFiltersEngine();
        renderHistoryTableScreen();
    } catch (err) {
        console.error("Error context loop during target stream fetch ingestion:", err);
    }
}

async function writeJsonFile() {
    fileStatus.innerText = "Pushing data logs up to Drive...";
    fileStatus.className = "text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200 px-3 py-1 rounded-full w-fit";
    try {
        await gapi.client.request({
            'path': `/upload/drive/v3/files/${fileId}`,
            'method': 'PATCH',
            'params': { 'uploadType': 'media' },
            'body': JSON.stringify(localData)
        });
        fileStatus.innerText = "Cloud Sync Secured";
        fileStatus.className = "text-xs font-medium bg-green-50 text-green-800 border border-green-200 px-3 py-1 rounded-full w-fit";
    } catch (err) {
        console.error("Cloud ingestion transmission write lock failure fault:", err);
    }
}

// --- STATEMENT FILTER SEPARATION COMPILATIONS ---
function populateMonthFiltersEngine() {
    const monthsSet = new Set();
    const currentCalendarMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    monthsSet.add(currentCalendarMonth);

    (localData.expenses || []).forEach(exp => {
        if (exp.date && exp.date.length >= 7) {
            monthsSet.add(exp.date.slice(0, 7)); // Captures only YYYY-MM
        }
    });

    const sortedMonths = Array.from(monthsSet).sort((a, b) => b.localeCompare(a));
    
    monthFilterSelect.innerHTML = "";
    sortedMonths.forEach(m => {
        const opt = document.createElement('option');
        opt.value = m;
        
        const [year, month] = m.split('-');
        const dateConversionObj = new Date(year, parseInt(month) - 1, 1);
        opt.innerText = dateConversionObj.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        
        monthFilterSelect.appendChild(opt);
    });

    monthFilterSelect.value = selectedMonth;
}

function calculateSelectedMonthAggregate() {
    return (localData.expenses || []).reduce((sum, exp) => {
        if (exp.date && exp.date.slice(0, 7) === selectedMonth) {
            return sum + parseFloat(exp.amount || 0);
        }
        return sum;
    }, 0);
}

// --- RENDERING VIEWS MECHANIC CONTROLLER ---

// Render Screen View State 2: Daily Tracker Screen Layout Tables
function renderHistoryTableScreen() {
    tableBody.innerHTML = "";
    
    const filteredExpenses = (localData.expenses || []).filter(exp => exp.date && exp.date.slice(0, 7) === selectedMonth);
    const chronologicalSortedData = filteredExpenses.sort((a, b) => new Date(b.date) - new Date(a.date));
    
    if (chronologicalSortedData.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-gray-400 italic bg-gray-50/50">No expenses logged for this statement period.</td></tr>`;
    } else {
        chronologicalSortedData.forEach(exp => {
            const row = document.createElement('tr');
            row.className = "hover:bg-gray-50/70 transition duration-150 group";
            row.innerHTML = `
                <td class="p-3 whitespace-nowrap text-gray-500 font-mono text-xs">${exp.date}</td>
                <td class="p-3"><span class="px-2 py-0.5 bg-blue-50 text-blue-700 text-xs font-semibold rounded-md border border-blue-100">${exp.category}</span></td>
                <td class="p-3 font-medium text-gray-800">${exp.description}</td>
                <td class="p-3 text-xs text-gray-400 max-w-[90px] truncate font-mono" title="${exp.createdBy}">${exp.createdBy ? exp.createdBy.split('@')[0] : 'System'}</td>
                <td class="p-3 text-right font-bold text-gray-900">$${parseFloat(exp.amount || 0).toFixed(2)}</td>
                <td class="p-3 text-center">
                    <button onclick="deleteExpenseEntryHook('${exp.id}')" class="text-gray-300 hover:text-red-600 hover:bg-red-50 transition duration-150 inline-flex items-center justify-center p-1.5 rounded-lg border border-transparent hover:border-red-100" title="Delete Expense Entry Line">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                        </svg>
                    </button>
                </td>
            `;
            tableBody.appendChild(row);
        });
    }

    const [year, month] = selectedMonth.split('-');
    const contextualVerboseDateString = new Date(year, parseInt(month) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    totalCardLabel.innerText = `Total Net Outflow Expenses (${contextualVerboseDateString})`;
    monthlyTotal.innerText = `$${calculateSelectedMonthAggregate().toFixed(2)}`;
}

// Render Screen View State 3: Monthly Aggregate Reports Graph List 
function renderMonthlyBreakdownScreen() {
    summaryTableBody.innerHTML = "";
    const analysisMatrix = {};

    (localData.expenses || []).forEach(exp => {
        if (exp.date && exp.date.length >= 7) {
            const indexKey = exp.date.slice(0, 7);
            if (!analysisMatrix[indexKey]) {
                analysisMatrix[indexKey] = { amount: 0, count: 0 };
            }
            analysisMatrix[indexKey].amount += parseFloat(exp.amount || 0);
            analysisMatrix[indexKey].count += 1;
        }
    });

    const historicalSequentialMonths = Object.keys(analysisMatrix).sort((a, b) => b.localeCompare(a));
    
    if (historicalSequentialMonths.length === 0) {
        summaryTableBody.innerHTML = `<tr><td colspan="3" class="p-8 text-center text-gray-400 italic bg-gray-50/50">No transaction records matching documentation metrics.</td></tr>`;
        return;
    }

    historicalSequentialMonths.forEach(m => {
        const [year, month] = m.split('-');
        const dynamicLabelVerbose = new Date(year, parseInt(month) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        
        const row = document.createElement('tr');
        row.className = "hover:bg-gray-50/50 transition duration-150";
        row.innerHTML = `
            <td class="p-4 font-bold text-gray-900">${dynamicLabelVerbose}</td>
            <td class="p-4 text-gray-500 font-medium text-xs">${analysisMatrix[m].count} processed logs</td>
            <td class="p-4 text-right font-extrabold text-blue-600 tracking-tight">$${analysisMatrix[m].amount.toFixed(2)}</td>
        `;
        summaryTableBody.appendChild(row);
    });
}

// --- ACTIONS & ROW HANDLERS ---
window.deleteExpenseEntryHook = function (expenseId) {
    if (!confirm('Are you sure you want to permanently delete this expense line item?')) return;
    localData.expenses = (localData.expenses || []).filter(exp => exp.id !== expenseId);
    
    populateMonthFiltersEngine();
    renderHistoryTableScreen();
    writeJsonFile();
};

expenseForm.onsubmit = async (e) => {
    e.preventDefault();
    
    const contextPickedDate = document.getElementById('exp-date').value;
    const newExpense = {
        id: 'exp_' + Date.now(),
        date: contextPickedDate,
        category: document.getElementById('exp-category').value,
        amount: parseFloat(document.getElementById('exp-amount').value) || 0,
        description: document.getElementById('exp-desc').value,
        createdBy: userEmail
    };

    await readJsonFile();
    localData.expenses.push(newExpense);
    
    // Automatically match active dropdown display selection state back to item context
    selectedMonth = contextPickedDate.slice(0, 7);
    
    populateMonthFiltersEngine();
    renderHistoryTableScreen();
    
    document.getElementById('exp-amount').value = '';
    document.getElementById('exp-desc').value = '';
    
    await writeJsonFile();
};