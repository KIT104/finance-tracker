// ===== Config / mode detection =====
const CLOUD =
  !!(window.SUPABASE_URL && window.SUPABASE_ANON_KEY) && !!window.supabase;
const sb = CLOUD
  ? window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY)
  : null;
let user = null;

const STORAGE_KEY = "finance-entries-v2";

/** @typedef {{id:string,type:"income"|"expense",date:string,category:string,amount:number,memo:string}} Entry */
/** @type {Entry[]} */
let entries = [];

// ===== Local cache helpers =====
function loadLocal() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}
function cacheLocal() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

// ===== Data layer (cloud or local) =====
function rowToEntry(r) {
  return {
    id: r.id,
    type: r.type,
    date: r.date,
    category: r.category,
    amount: Number(r.amount),
    memo: r.memo || "",
  };
}

// Make sure we have a live authenticated user before a write. The module-level
// `user` can fall out of sync (token refresh, multiple tabs, init races), so if
// it's missing we re-read the session from storage (which also refreshes an
// expired token) before giving up. This is what fixes "Add Record does nothing".
async function ensureUser() {
  if (!CLOUD) return null;
  if (user) return user;
  const { data } = await sb.auth.getSession();
  if (data.session) {
    user = data.session.user;
    setAccountUI();
    showAuth(false);
    return user;
  }
  showAuth(true);
  throw new Error("You are signed out. Please sign in again, then retry.");
}

async function fetchEntries() {
  if (CLOUD && user) {
    const { data, error } = await sb
      .from("transactions")
      .select("*")
      .order("date", { ascending: true });
    if (error) throw error;
    entries = data.map(rowToEntry);
    cacheLocal();
  } else {
    entries = loadLocal();
  }
}

async function addEntry(e) {
  const u = await ensureUser();
  if (CLOUD) {
    const { data, error } = await sb
      .from("transactions")
      .insert({
        user_id: u.id,
        type: e.type,
        date: e.date,
        category: e.category,
        amount: e.amount,
        memo: e.memo,
      })
      .select()
      .single();
    if (error) throw error;
    entries.push(rowToEntry(data));
  } else {
    entries.push({ id: crypto.randomUUID(), ...e });
  }
  cacheLocal();
}

async function addMany(list) {
  const u = await ensureUser();
  if (CLOUD) {
    const rows = list.map((e) => ({
      user_id: u.id,
      type: e.type,
      date: e.date,
      category: e.category,
      amount: e.amount,
      memo: e.memo,
    }));
    const { data, error } = await sb.from("transactions").insert(rows).select();
    if (error) throw error;
    entries.push(...data.map(rowToEntry));
  } else {
    entries.push(...list.map((e) => ({ id: crypto.randomUUID(), ...e })));
  }
  cacheLocal();
}

async function removeEntry(id) {
  if (CLOUD && user) {
    const { error } = await sb.from("transactions").delete().eq("id", id);
    if (error) throw error;
  }
  entries = entries.filter((en) => en.id !== id);
  cacheLocal();
}

async function clearEntries() {
  if (CLOUD && user) {
    const { error } = await sb
      .from("transactions")
      .delete()
      .eq("user_id", user.id);
    if (error) throw error;
  }
  entries = [];
  cacheLocal();
}

// ===== Categories =====
const CATEGORIES = {
  expense: [
    "Food",
    "Daily Goods",
    "Transport",
    "Housing",
    "Utilities",
    "Communication",
    "Entertainment",
    "Medical",
    "Social",
    "Clothing",
    "Other",
  ],
  income: ["Salary", "Bonus", "Side Job", "Investment", "Gift", "Other"],
};

const CATEGORY_COLORS = {
  Food: "#f87171",
  "Daily Goods": "#fb923c",
  Transport: "#facc15",
  Housing: "#4ade80",
  Utilities: "#2dd4bf",
  Communication: "#60a5fa",
  Entertainment: "#a78bfa",
  Medical: "#f472b6",
  Social: "#fb7185",
  Clothing: "#22d3ee",
  Other: "#94a3b8",
  Salary: "#34d399",
  Bonus: "#10b981",
  "Side Job": "#14b8a6",
  Investment: "#06b6d4",
  Gift: "#a3e635",
};

const usd = (n) =>
  (n < 0 ? "-$" : "$") +
  Math.abs(n).toLocaleString("en-US", { maximumFractionDigits: 0 });

// ===== Element refs =====
const form = document.getElementById("entry-form");
const typeToggle = document.getElementById("type-toggle");
const dateInput = document.getElementById("date");
const categoryInput = document.getElementById("category");
const amountInput = document.getElementById("amount");
const memoInput = document.getElementById("memo");
const monthSelect = document.getElementById("month-select");
const tbody = document.getElementById("entry-tbody");
const emptyState = document.getElementById("empty-state");

let currentType = "expense";
let currentMonth = "all";

dateInput.value = new Date().toISOString().slice(0, 10);

// ===== Category options =====
function refreshCategoryOptions() {
  categoryInput.innerHTML = CATEGORIES[currentType]
    .map((c) => `<option value="${c}">${c}</option>`)
    .join("");
}
refreshCategoryOptions();

typeToggle.addEventListener("click", (e) => {
  const btn = e.target.closest(".toggle-btn");
  if (!btn) return;
  currentType = btn.dataset.type;
  typeToggle
    .querySelectorAll(".toggle-btn")
    .forEach((b) => b.classList.toggle("active", b === btn));
  refreshCategoryOptions();
});

// ===== Form submit =====
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const amount = Number(amountInput.value);
  if (!dateInput.value) {
    alert("Please choose a date.");
    return;
  }
  if (!(amount >= 0) || amountInput.value === "") {
    alert("Please enter a valid amount.");
    amountInput.focus();
    return;
  }

  const submitBtn = form.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  try {
    await addEntry({
      type: currentType,
      date: dateInput.value,
      category: categoryInput.value,
      amount,
      memo: memoInput.value.trim(),
    });
    amountInput.value = "";
    memoInput.value = "";
    amountInput.focus();
    refreshMonthOptions();
    render();
  } catch (err) {
    alert("Failed to save: " + (err?.message || err));
  } finally {
    submitBtn.disabled = false;
  }
});

// ===== Delete & clear =====
tbody.addEventListener("click", async (e) => {
  const btn = e.target.closest(".del-btn");
  if (!btn) return;
  try {
    await removeEntry(btn.dataset.id);
    refreshMonthOptions();
    render();
  } catch (err) {
    alert("Failed to delete: " + (err?.message || err));
  }
});

document.getElementById("clear-all").addEventListener("click", async () => {
  if (entries.length === 0) return;
  if (!confirm("Delete ALL records? This cannot be undone.")) return;
  try {
    await clearEntries();
    refreshMonthOptions();
    render();
  } catch (err) {
    alert("Failed to clear: " + (err?.message || err));
  }
});

// ===== Refresh (cloud) =====
const refreshBtn = document.getElementById("refresh-btn");
refreshBtn.addEventListener("click", async () => {
  refreshBtn.disabled = true;
  try {
    await fetchEntries();
    refreshMonthOptions();
    render();
  } catch (err) {
    alert("Failed to refresh: " + (err?.message || err));
  } finally {
    refreshBtn.disabled = false;
  }
});

// Re-pull when returning to the tab (keeps devices roughly in sync).
// Debounced so mobile's frequent focus/blur doesn't spam the network.
if (CLOUD) {
  let focusTimer = null;
  window.addEventListener("focus", () => {
    if (!user) return;
    clearTimeout(focusTimer);
    focusTimer = setTimeout(async () => {
      try {
        await fetchEntries();
        refreshMonthOptions();
        render();
      } catch {
        /* ignore transient refresh errors */
      }
    }, 600);
  });
}

// ===== Month filter =====
function availableMonths() {
  return [...new Set(entries.map((e) => e.date.slice(0, 7)))].sort().reverse();
}

function refreshMonthOptions() {
  const months = availableMonths();
  const prev = currentMonth;
  monthSelect.innerHTML =
    `<option value="all">All Time</option>` +
    months
      .map((m) => {
        const label = new Date(m + "-01").toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
        });
        return `<option value="${m}">${label}</option>`;
      })
      .join("");
  currentMonth = prev === "all" || months.includes(prev) ? prev : "all";
  monthSelect.value = currentMonth;
}

monthSelect.addEventListener("change", () => {
  currentMonth = monthSelect.value;
  render();
});

// ===== Filtering =====
function filtered() {
  if (currentMonth === "all") return entries;
  return entries.filter((e) => e.date.startsWith(currentMonth));
}

// ===== Charts =====
const GRID = "rgba(255,255,255,0.06)";
const TICK = "#8b949e";
let barChart, lineChart;

function line(label, data, color) {
  return {
    label,
    data,
    borderColor: color,
    backgroundColor: color + "22",
    fill: false,
    tension: 0.3,
    pointRadius: 3,
    pointBackgroundColor: color,
  };
}

function renderCharts() {
  const data = filtered();
  const dates = [...new Set(data.map((e) => e.date))].sort();

  const expenseCats = CATEGORIES.expense.filter((cat) =>
    data.some((e) => e.type === "expense" && e.category === cat)
  );
  const dailyExpenseTotal = dates.map((d) =>
    data
      .filter((e) => e.type === "expense" && e.date === d)
      .reduce((s, e) => s + e.amount, 0)
  );

  const barDatasets = expenseCats.map((cat) => ({
    label: cat,
    data: dates.map((d) =>
      data
        .filter(
          (e) => e.type === "expense" && e.date === d && e.category === cat
        )
        .reduce((s, e) => s + e.amount, 0)
    ),
    backgroundColor: CATEGORY_COLORS[cat],
    stack: "expense",
  }));

  if (barChart) barChart.destroy();
  barChart = new Chart(document.getElementById("bar-chart"), {
    type: "bar",
    data: { labels: dates, datasets: barDatasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { stacked: true, grid: { color: GRID }, ticks: { color: TICK } },
        y: {
          stacked: true,
          beginAtZero: true,
          grid: { color: GRID },
          ticks: { color: TICK, callback: (v) => usd(v) },
        },
      },
      plugins: {
        legend: { position: "bottom", labels: { color: TICK } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const total = dailyExpenseTotal[ctx.dataIndex] || 1;
              const pct = ((ctx.parsed.y / total) * 100).toFixed(0);
              return `${ctx.dataset.label}: ${usd(ctx.parsed.y)} (${pct}%)`;
            },
          },
        },
      },
    },
  });

  const incomeSeries = dates.map((d) =>
    data
      .filter((e) => e.type === "income" && e.date === d)
      .reduce((s, e) => s + e.amount, 0)
  );
  const netSeries = dates.map((d, i) => incomeSeries[i] - dailyExpenseTotal[i]);

  if (lineChart) lineChart.destroy();
  lineChart = new Chart(document.getElementById("line-chart"), {
    type: "line",
    data: {
      labels: dates,
      datasets: [
        line("Income", incomeSeries, "#34d399"),
        line("Expense", dailyExpenseTotal, "#f87171"),
        line("Net", netSeries, "#6366f1"),
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: { grid: { color: GRID }, ticks: { color: TICK } },
        y: {
          grid: { color: GRID },
          ticks: { color: TICK, callback: (v) => usd(v) },
        },
      },
      plugins: {
        legend: { position: "bottom", labels: { color: TICK } },
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${usd(ctx.parsed.y)}`,
          },
        },
      },
    },
  });
}

// ===== Summary =====
function renderSummary() {
  const data = filtered();
  const income = data
    .filter((e) => e.type === "income")
    .reduce((s, e) => s + e.amount, 0);
  const expense = data
    .filter((e) => e.type === "expense")
    .reduce((s, e) => s + e.amount, 0);

  document.getElementById("stat-income").textContent = usd(income);
  document.getElementById("stat-expense").textContent = usd(expense);
  const balEl = document.getElementById("stat-balance");
  const bal = income - expense;
  balEl.textContent = usd(bal);
  balEl.style.color = bal >= 0 ? "var(--income)" : "var(--expense)";
  document.getElementById("stat-count").textContent = data.length;
}

// ===== Table =====
function renderTable() {
  const data = [...filtered()].sort((a, b) => b.date.localeCompare(a.date));
  tbody.innerHTML = data
    .map((e) => {
      const sign = e.type === "income" ? "+" : "-";
      const amtClass = e.type === "income" ? "amount-income" : "amount-expense";
      return `
      <tr>
        <td>${e.date}</td>
        <td><span class="tag ${e.type}">${e.type}</span></td>
        <td><span style="color:${
          CATEGORY_COLORS[e.category] || "#94a3b8"
        }">●</span> ${e.category}</td>
        <td class="num ${amtClass}">${sign}${usd(e.amount)}</td>
        <td>${escapeHtml(e.memo)}</td>
        <td><button class="del-btn" data-id="${e.id}" title="Delete">✕</button></td>
      </tr>`;
    })
    .join("");
  emptyState.style.display = data.length ? "none" : "block";
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ===== CSV Export / Import =====
function toCSV(list) {
  const header = ["type", "date", "category", "amount", "memo"];
  const rows = list.map((e) =>
    [e.type, e.date, e.category, e.amount, e.memo].map(csvCell).join(",")
  );
  return [header.join(","), ...rows].join("\r\n");
}

function csvCell(v) {
  const s = String(v ?? "");
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

document.getElementById("export-btn").addEventListener("click", () => {
  if (entries.length === 0) {
    alert("No records to export.");
    return;
  }
  const blob = new Blob([toCSV(entries)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `finance-backup-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

const importFile = document.getElementById("import-file");
document
  .getElementById("import-btn")
  .addEventListener("click", () => importFile.click());

importFile.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const imported = parseCSV(reader.result);
      if (imported.length === 0) {
        alert("No valid rows found in the CSV.");
        return;
      }
      const replace = confirm(
        `Found ${imported.length} records.\n\nOK = Replace all current data\nCancel = Merge with current data`
      );
      if (replace) await clearEntries();
      await addMany(imported);
      refreshMonthOptions();
      render();
      alert(`Imported ${imported.length} records.`);
    } catch (err) {
      alert("Failed to import CSV: " + (err?.message || err));
    } finally {
      importFile.value = "";
    }
  };
  reader.readAsText(file);
});

function parseCSV(text) {
  const rows = csvToRows(text.trim());
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const idx = {
    type: header.indexOf("type"),
    date: header.indexOf("date"),
    category: header.indexOf("category"),
    amount: header.indexOf("amount"),
    memo: header.indexOf("memo"),
  };
  const out = [];
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    if (!r.length || r.every((c) => c === "")) continue;
    const type = (r[idx.type] || "expense").trim().toLowerCase();
    const date = (r[idx.date] || "").trim();
    const amount = Number(r[idx.amount]);
    if (!date || !(amount >= 0)) continue;
    out.push({
      type: type === "income" ? "income" : "expense",
      date,
      category: (r[idx.category] || "Other").trim(),
      amount,
      memo: (r[idx.memo] || "").trim(),
    });
  }
  return out;
}

function csvToRows(text) {
  const rows = [];
  let row = [],
    cell = "",
    inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else inQuotes = false;
      } else cell += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\r") {
      // handled by \n
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

// ===== Render all =====
function render() {
  renderSummary();
  renderCharts();
  renderTable();
}

// ===== Auth =====
const authOverlay = document.getElementById("auth-overlay");
const authForm = document.getElementById("auth-form");
const authEmail = document.getElementById("auth-email");
const authPassword = document.getElementById("auth-password");
const authError = document.getElementById("auth-error");
const accountBar = document.getElementById("account-bar");
const accountStatus = document.getElementById("account-status");
const signoutBtn = document.getElementById("signout-btn");

async function startApp() {
  await fetchEntries();
  refreshMonthOptions();
  render();
}

function showAuth(show) {
  authOverlay.hidden = !show;
}

function setAccountUI() {
  accountBar.hidden = false;
  if (CLOUD && user) {
    accountStatus.textContent = `☁ Synced · ${user.email}`;
    signoutBtn.hidden = false;
    refreshBtn.hidden = false;
  } else if (CLOUD) {
    accountStatus.textContent = "";
    signoutBtn.hidden = true;
    refreshBtn.hidden = true;
  } else {
    accountStatus.textContent = "💾 Local mode (this device only)";
    signoutBtn.hidden = true;
    refreshBtn.hidden = true;
  }
}

if (CLOUD) {
  async function doAuth(kind) {
    authError.style.color = "var(--danger)";
    authError.textContent = "";
    const email = authEmail.value.trim();
    const password = authPassword.value;
    if (!email || password.length < 6) {
      authError.textContent = "Enter an email and a password of 6+ characters.";
      return;
    }
    const { data, error } =
      kind === "signup"
        ? await sb.auth.signUp({ email, password })
        : await sb.auth.signInWithPassword({ email, password });
    if (error) {
      authError.textContent = error.message;
      return;
    }
    if (kind === "signup" && !data.session) {
      authError.style.color = "var(--income)";
      authError.textContent =
        "Account created. Check your email to confirm, then sign in.";
    }
    // When a session exists, onAuthStateChange handles the rest.
  }

  authForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    await doAuth("signin");
  });
  document
    .getElementById("signup-btn")
    .addEventListener("click", () => doAuth("signup"));

  signoutBtn.addEventListener("click", async () => {
    await sb.auth.signOut();
  });

  sb.auth.onAuthStateChange(async (_event, session) => {
    user = session?.user || null;
    setAccountUI();
    if (user) {
      showAuth(false);
      await startApp();
    } else {
      showAuth(true);
      entries = [];
      render();
      refreshMonthOptions();
    }
  });

  sb.auth.getSession().then(({ data }) => {
    if (!data.session) {
      showAuth(true);
      setAccountUI();
    }
  });
} else {
  setAccountUI();
  startApp();
}
