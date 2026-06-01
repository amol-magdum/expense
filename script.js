// --- CONFIGURATION MANAGEMENT ---
// These placeholders will be automatically overwritten by GitHub Actions during deployment
const CLIENT_ID = '44826419479-gk0j5gnb75muvo8i3e5981fujh94mbte.apps.googleusercontent.com'; 
const API_KEY = 'AIzaSyCjR3KuwmT4Hu-5fk11SWD5b48TwIyQwek';

const SCOPES = 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email';
const FILE_NAME = 'app_expenses.json';

// When set, the app reads/writes this exact Drive file (a household file shared by
// another member) instead of searching for / creating the user's own file.
const HOUSEHOLD_FILE_KEY = 'household_file_id';

let tokenClient;
let accessToken = null;
let refreshTimerId = null;
let fileId = null;
let localData = { expenses: [] };
let userEmail = "";
let pickerApiLoaded = false;

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

// Household sharing controls
const householdIdInput = document.getElementById('household-id');
const copyHouseholdBtn = document.getElementById('copy-household-btn');
const inviteEmailInput = document.getElementById('invite-email');
const inviteBtn = document.getElementById('invite-btn');
const joinBtn = document.getElementById('join-btn');
const householdStatus = document.getElementById('household-status');
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
        scheduleTokenRefresh(parseInt(expiry));
    } else {
        localStorage.removeItem('drive_expense_token');
        localStorage.removeItem('drive_expense_token_expiry');
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
                // Init failed with an existing session; clear it so the user can re-authenticate cleanly
                // instead of silently re-running the success path against an uninitialized client.
                localStorage.removeItem('drive_expense_token');
                localStorage.removeItem('drive_expense_token_expiry');
                accessToken = null;
            }
        }
    });

    gapi.load('picker', () => { pickerApiLoaded = true; });

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
            
            scheduleTokenRefresh(expiryTimestamp);
            
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

    copyHouseholdBtn.onclick = copyHouseholdId;
    inviteBtn.onclick = inviteHouseholdMember;
    joinBtn.onclick = openHouseholdPicker;

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

// --- TOKEN LIFECYCLE ---
// Proactively request a fresh token a little before the stored expiry so the session
// never lapses mid-use. expiryTimestamp already includes a 5-minute safety buffer.
function scheduleTokenRefresh(expiryTimestamp) {
    if (refreshTimerId !== null) {
        clearTimeout(refreshTimerId);
        refreshTimerId = null;
    }

    const msUntilRefresh = expiryTimestamp - Date.now();
    if (msUntilRefresh <= 0) {
        // Already within the buffer window; refresh immediately.
        if (tokenClient) tokenClient.requestAccessToken({ prompt: '' });
        return;
    }

    refreshTimerId = setTimeout(() => {
        refreshTimerId = null;
        if (tokenClient) tokenClient.requestAccessToken({ prompt: '' });
    }, msUntilRefresh);
}

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
        document.getElementById('user-email').textContent = `Sync Profile: ${userEmail}`;
        
        await syncDriveCloudFile();
    } catch (err) {
        console.error("User configuration sync error baseline context:", err);
        terminateSession();
    }
}

function terminateSession() {
    if (refreshTimerId !== null) {
        clearTimeout(refreshTimerId);
        refreshTimerId = null;
    }
    localStorage.removeItem('drive_expense_token');
    localStorage.removeItem('drive_expense_token_expiry');
    location.reload();
}

// --- CLOUD DATABASING FILE CONTROLS ---
async function syncDriveCloudFile() {
    fileStatus.textContent = "Scanning Drive Storage...";

    // If the user joined a household, read/write that shared file directly by ID.
    // Files created by this app remain accessible to anyone the file is shared with
    // (drive.file scope grants per-file access to files the app created or opened).
    const householdFileId = localStorage.getItem(HOUSEHOLD_FILE_KEY);
    if (householdFileId) {
        try {
            await gapi.client.drive.files.get({ fileId: householdFileId, fields: 'id' });
            fileId = householdFileId;
            fileStatus.textContent = "Connected to Household File";
            fileStatus.className = "text-xs font-medium bg-green-50 text-green-800 border border-green-200 px-3 py-1 rounded-full w-fit";
            updateHouseholdIdDisplay();
            await readJsonFile();
            return;
        } catch (err) {
            console.error("Household file access error context:", err);
            fileStatus.textContent = "Household File Not Accessible";
            fileStatus.className = "text-xs font-medium bg-red-50 text-red-800 border border-red-200 px-3 py-1 rounded-full w-fit";
            setHouseholdStatus("Couldn't open that household file. Make sure the owner shared it with " + (userEmail || "your account") + ", then use Select Shared File again.", true);
            return;
        }
    }

    try {
        const response = await gapi.client.drive.files.list({
            q: `name = '${FILE_NAME}' and trashed = false`,
            fields: 'files(id, name)',
            spaces: 'drive'
        });

        const files = response.result.files;
        if (files && files.length > 0) {
            fileId = files[0].id;
            fileStatus.textContent = "Cloud Connection Established";
            fileStatus.className = "text-xs font-medium bg-green-50 text-green-800 border border-green-200 px-3 py-1 rounded-full w-fit";
            updateHouseholdIdDisplay();
            await readJsonFile();
        } else {
            fileStatus.textContent = "Building Cloud Registry File...";
            await createJsonFile();
        }
    } catch (err) {
        console.error("Cloud lookup fault error registry context:", err);
        fileStatus.textContent = "Database File Error Connection Loss";
        fileStatus.className = "text-xs font-medium bg-red-50 text-red-800 border border-red-200 px-3 py-1 rounded-full w-fit";
    }
}

// --- HOUSEHOLD SHARING ---
function setHouseholdStatus(message, isError) {
    if (!householdStatus) return;
    householdStatus.textContent = message;
    householdStatus.classList.remove('hidden');
    householdStatus.className = isError
        ? "text-[11px] mt-2 leading-snug text-red-600"
        : "text-[11px] mt-2 leading-snug text-green-600";
}

function updateHouseholdIdDisplay() {
    if (householdIdInput) householdIdInput.value = fileId || "";
}

async function copyHouseholdId() {
    if (!fileId) {
        setHouseholdStatus("No household file is connected yet.", true);
        return;
    }
    try {
        await navigator.clipboard.writeText(fileId);
        setHouseholdStatus("Household ID copied. Share it with your household members.", false);
    } catch (err) {
        // Clipboard can be blocked (e.g. insecure context); fall back to selecting the field.
        if (householdIdInput) {
            householdIdInput.focus();
            householdIdInput.select();
        }
        setHouseholdStatus("Copy failed — the ID is selected, press Ctrl/Cmd+C to copy.", true);
    }
}

async function inviteHouseholdMember() {
    const email = (inviteEmailInput.value || "").trim();
    if (!email) {
        setHouseholdStatus("Enter the member's Google account email to invite.", true);
        return;
    }
    if (!fileId) {
        setHouseholdStatus("No household file is connected yet.", true);
        return;
    }

    inviteBtn.disabled = true;
    try {
        await gapi.client.drive.permissions.create({
            fileId: fileId,
            sendNotificationEmail: true,
            resource: { type: 'user', role: 'writer', emailAddress: email }
        });
        inviteEmailInput.value = "";
        setHouseholdStatus(`Invited ${email}. Share your Household ID so they can Join.`, false);
    } catch (err) {
        console.error("Household invite error context:", err);
        setHouseholdStatus("Couldn't invite that member. Only the file owner can share it.", true);
    } finally {
        inviteBtn.disabled = false;
    }
}

async function openHouseholdPicker() {
    if (!pickerApiLoaded || typeof google === 'undefined' || !google.picker) {
        setHouseholdStatus("File picker is still loading. Please try again in a moment.", true);
        return;
    }
    if (!accessToken) {
        setHouseholdStatus("Sign in first, then select the shared file.", true);
        return;
    }

    // With the drive.file scope, the app can only access a file shared by another
    // member after the user explicitly selects it through the Google Picker. This
    // selection is what grants the app per-file access to the shared household file.
    const view = new google.picker.DocsView(google.picker.ViewId.DOCS)
        .setMode(google.picker.DocsViewMode.LIST)
        .setIncludeFolders(false)
        .setOwnedByMe(false)        // show files shared with the user, not just their own
        .setMimeTypes('application/json');

    // The OAuth token alone authorizes Drive access in the Picker. A developer key is
    // only added when one is configured; passing an unset/referrer-restricted key here
    // is what triggers "API developer key invalid" on some devices, so it stays optional.
    const builder = new google.picker.PickerBuilder()
        .setAppId(CLIENT_ID.split('-')[0])   // Cloud project number, derived from the client ID
        .setOAuthToken(accessToken)
        .addView(view)
        .setTitle('Select your household expense file (app_expenses.json)')
        .setCallback(handlePickerResult);

    if (API_KEY && API_KEY !== 'AIzaSyCjR3KuwmT4Hu-5fk11SWD5b48TwIyQwek') {
        builder.setDeveloperKey(API_KEY);
    }

    const picker = builder.build();
    picker.setVisible(true);
}

function handlePickerResult(data) {
    if (!data || data[google.picker.Response.ACTION] !== google.picker.Action.PICKED) {
        return;
    }

    const doc = data[google.picker.Response.DOCUMENTS] && data[google.picker.Response.DOCUMENTS][0];
    const pickedId = doc && doc[google.picker.Document.ID];
    if (!pickedId) {
        setHouseholdStatus("No file was selected.", true);
        return;
    }

    localStorage.setItem(HOUSEHOLD_FILE_KEY, pickedId);
    setHouseholdStatus("Connected to household file. Reloading shared expenses...", false);
    setTimeout(() => location.reload(), 800);
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
    updateHouseholdIdDisplay();
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
        // Shape validation: ensure we always work with { expenses: [] }
        if (!localData || typeof localData !== 'object') localData = { expenses: [] };
        if (!Array.isArray(localData.expenses)) localData.expenses = [];

        populateMonthFiltersEngine();
        renderHistoryTableScreen();
    } catch (err) {
        console.error("Error context loop during target stream fetch ingestion:", err);
    }
}

// Serializes Drive writes so overlapping saves can't complete out of order and
// overwrite newer data with older. The latest in-memory state is always written last.
let isWriting = false;
let pendingWrite = false;

async function persistData() {
    if (isWriting) {
        pendingWrite = true;
        return;
    }
    isWriting = true;
    try {
        await writeJsonFile();
    } finally {
        isWriting = false;
        if (pendingWrite) {
            pendingWrite = false;
            persistData();
        }
    }
}

async function writeJsonFile() {
    fileStatus.textContent = "Pushing data logs up to Drive...";
    fileStatus.className = "text-xs font-medium bg-amber-50 text-amber-800 border border-amber-200 px-3 py-1 rounded-full w-fit";
    try {
        await gapi.client.request({
            'path': `/upload/drive/v3/files/${fileId}`,
            'method': 'PATCH',
            'params': { 'uploadType': 'media' },
            'body': JSON.stringify(localData)
        });
        fileStatus.textContent = "Cloud Sync Secured";
        fileStatus.className = "text-xs font-medium bg-green-50 text-green-800 border border-green-200 px-3 py-1 rounded-full w-fit";
    } catch (err) {
        console.error("Cloud ingestion transmission write lock failure fault:", err);
        fileStatus.textContent = "Unsaved changes \u2014 sync failed. Will retry on next change.";
        fileStatus.className = "text-xs font-medium bg-red-50 text-red-800 border border-red-200 px-3 py-1 rounded-full w-fit";
    }
}

// --- STATEMENT FILTER SEPARATION COMPILATIONS ---
function populateMonthFiltersEngine() {
    const monthsSet = new Set();
    const today = new Date();
    const currentCalendarMonth = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
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
        opt.textContent = dateConversionObj.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        
        monthFilterSelect.appendChild(opt);
    });

    monthFilterSelect.value = selectedMonth;
}

// Round to 2 decimals to avoid floating-point drift accumulating across many entries.
function roundMoney(value) {
    return Math.round((parseFloat(value) || 0) * 100) / 100;
}

function calculateSelectedMonthAggregate() {
    const total = (localData.expenses || []).reduce((sum, exp) => {
        if (exp.date && exp.date.slice(0, 7) === selectedMonth) {
            return sum + (parseFloat(exp.amount) || 0);
        }
        return sum;
    }, 0);
    return roundMoney(total);
}

// --- RENDERING VIEWS MECHANIC CONTROLLER ---

// Render Screen View State 2: Daily Tracker Screen Layout Tables
function renderHistoryTableScreen() {
    tableBody.innerHTML = "";
    
    const filteredExpenses = (localData.expenses || []).filter(exp => exp.date && exp.date.slice(0, 7) === selectedMonth);
    // Stable chronological sort for YYYY-MM-DD strings (avoid timezone parsing differences)
    const chronologicalSortedData = filteredExpenses.sort((a, b) => {
        const ad = typeof a.date === 'string' ? a.date : '';
        const bd = typeof b.date === 'string' ? b.date : '';
        return bd.localeCompare(ad);
    });

    if (chronologicalSortedData.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="6" class="p-6 text-center text-gray-400 italic bg-gray-50/50">No expenses logged for this statement period.</td></tr>`;
    } else {
        // Build all rows into a fragment and append once to avoid repeated reflows.
        const fragment = document.createDocumentFragment();
        chronologicalSortedData.forEach(exp => {
            const row = document.createElement('tr');
            row.className = "hover:bg-gray-50/70 transition duration-150 group";

            const tdDate = document.createElement('td');
            tdDate.className = "p-3 whitespace-nowrap text-gray-500 font-mono text-xs";
            tdDate.setAttribute('data-label', 'Date');
            tdDate.textContent = exp.date || '';

            const tdCategory = document.createElement('td');
            tdCategory.className = "p-3";
            tdCategory.setAttribute('data-label', 'Category');
            const categoryPill = document.createElement('span');
            categoryPill.className = "px-2 py-0.5 bg-blue-50 text-blue-700 text-xs font-semibold rounded-md border border-blue-100";
            categoryPill.textContent = exp.category || '';
            tdCategory.appendChild(categoryPill);

            const tdDesc = document.createElement('td');
            tdDesc.className = "p-3 font-medium text-gray-800";
            tdDesc.setAttribute('data-label', 'Description');
            tdDesc.textContent = exp.description || '';

            const tdUser = document.createElement('td');
            tdUser.className = "p-3 text-xs text-gray-400 max-w-[90px] truncate font-mono hidden md:table-cell";
            const createdBy = exp.createdBy || '';
            tdUser.title = createdBy;
            tdUser.textContent = createdBy ? createdBy.split('@')[0] : 'System';

            const tdAmount = document.createElement('td');
            tdAmount.className = "p-3 text-right font-bold text-gray-900";
            tdAmount.setAttribute('data-label', 'Amount');
            tdAmount.textContent = `₹${parseFloat(exp.amount || 0).toFixed(2)}`;

            const tdAction = document.createElement('td');
            tdAction.className = "p-3 text-center";
            const delBtn = document.createElement('button');
            delBtn.className = "text-gray-300 hover:text-red-600 hover:bg-red-50 transition duration-150 inline-flex items-center justify-center p-1.5 rounded-lg border border-transparent hover:border-red-100";
            delBtn.title = "Delete Expense Entry Line";
            delBtn.type = 'button';
            delBtn.addEventListener('click', () => window.deleteExpenseEntryHook(exp.id));

            delBtn.innerHTML = `
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                </svg>
            `;

            tdAction.appendChild(delBtn);

            row.appendChild(tdDate);
            row.appendChild(tdCategory);
            row.appendChild(tdDesc);
            row.appendChild(tdUser);
            row.appendChild(tdAmount);
            row.appendChild(tdAction);

            fragment.appendChild(row);
        });
        tableBody.appendChild(fragment);
    }


    const [year, month] = selectedMonth.split('-');
    const contextualVerboseDateString = new Date(year, parseInt(month) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    totalCardLabel.textContent = `Total Expenses (${contextualVerboseDateString})`;
    monthlyTotal.textContent = `₹${calculateSelectedMonthAggregate().toFixed(2)}`;
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
            <td class="p-4 text-right font-extrabold text-blue-600 tracking-tight">₹${analysisMatrix[m].amount.toFixed(2)}</td>
        `;
        summaryTableBody.appendChild(row);
    });
}

// --- ACTIONS & ROW HANDLERS ---
window.deleteExpenseEntryHook = async function (expenseId) {
    if (!confirm('Are you sure you want to permanently delete this expense line item?')) return;
    localData.expenses = (localData.expenses || []).filter(exp => exp.id !== expenseId);
    
    populateMonthFiltersEngine();
    renderHistoryTableScreen();
    await persistData();
};

let isSubmittingExpense = false;
expenseForm.onsubmit = async (e) => {
    e.preventDefault();
    if (isSubmittingExpense) return; // Prevent duplicate submissions from rapid double-taps

    const contextPickedDate = document.getElementById('exp-date').value;
    const parsedAmount = parseFloat(document.getElementById('exp-amount').value);

    // Validate at the input boundary before mutating state.
    if (!contextPickedDate) {
        alert('Please select a valid date for this expense.');
        return;
    }
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        alert('Please enter an amount greater than zero.');
        return;
    }

    const newExpense = {
        id: 'exp_' + Date.now(),
        date: contextPickedDate,
        category: document.getElementById('exp-category').value,
        amount: roundMoney(parsedAmount),
        description: document.getElementById('exp-desc').value,
        createdBy: userEmail
    };

    isSubmittingExpense = true;
    const submitBtn = expenseForm.querySelector('button[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;

    try {
        // Use in-memory state to avoid an extra Drive read on every add
        localData.expenses.push(newExpense);

        // Automatically match active dropdown display selection state back to item context
        selectedMonth = contextPickedDate.slice(0, 7);

        populateMonthFiltersEngine();
        renderHistoryTableScreen();

        document.getElementById('exp-amount').value = '';
        document.getElementById('exp-desc').value = '';

        await persistData();
    } finally {
        isSubmittingExpense = false;
        if (submitBtn) submitBtn.disabled = false;
    }
};