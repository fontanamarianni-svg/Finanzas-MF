(() => {
  'use strict';

  const config = window.FINANZAS_CONFIG;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const money = new Intl.NumberFormat('es-VE', { style: 'currency', currency: 'USD' });
  const pairEmails = {
    anny: (config?.accounts?.anny || 'fontanamarianni@gmail.com').toLowerCase(),
    danny: (config?.accounts?.danny || 'josedgonzalezm127@gmail.com').toLowerCase()
  };
  const state = { db: null, user: null, purchases: [], payments: [], entries: [], creatingAccount: false, sessionVersion: 0 };

  function today() {
    const date = new Date();
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  const formatMoney = (value) => money.format(Number(value || 0));
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  const formatDate = (value) => {
    if (!value) return 'Sin fecha';
    const [year, month, day] = value.slice(0, 10).split('-');
    return `${day}/${month}/${year}`;
  };

  function currentIdentity() {
    const email = (state.user?.email || '').toLowerCase();
    if (email === pairEmails.danny) return { name: 'Danny', person: 'Danny', email, isMember: true, theme: 'danny' };
    if (email === pairEmails.anny) return { name: 'Anny', person: 'Anny', email, isMember: true, theme: 'anny' };
    return { name: 'Cuenta no autorizada', person: null, email, isMember: false, theme: 'anny' };
  }

  function notify(message, type = 'success') {
    const notice = $('#notice');
    notice.textContent = message;
    notice.className = `fixed right-4 top-4 z-[70] max-w-sm rounded-xl border px-4 py-3 text-sm shadow-2xl ${type === 'error' ? 'border-red-400/40 bg-red-950 text-red-100' : 'border-emerald-400/40 bg-emerald-950 text-emerald-100'}`;
    clearTimeout(notify.timeout);
    notify.timeout = setTimeout(() => notice.classList.add('hidden'), 4800);
  }

  function setButton(button, loading, loadingText = 'Guardando…') {
    if (!button.dataset.originalText) button.dataset.originalText = button.textContent;
    button.disabled = loading;
    button.textContent = loading ? loadingText : button.dataset.originalText;
  }

  function validateConfig() {
    if (!config?.supabaseUrl || !config?.supabasePublishableKey || config.supabaseUrl.includes('/rest/v1')) throw new Error('Falta configurar Supabase correctamente en config.js.');
    state.db = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey);
  }

  function showApp(isLoggedIn) {
    $('#auth-view').classList.toggle('hidden', isLoggedIn);
    $('#app-view').classList.toggle('hidden', !isLoggedIn);
  }

  function closePaymentModal() {
    $('#payment-modal').classList.add('hidden');
    $('#payment-modal').classList.remove('flex');
  }

  function clearAccountData() {
    state.purchases = [];
    state.payments = [];
    state.entries = [];
    ['#wallet-balance', '#income-total', '#expense-total', '#cashea-outstanding', '#income-list-total', '#expense-list-total'].forEach((selector) => { $(selector).textContent = '$0.00'; });
    $('#purchase-badge').textContent = '0';
    $('#recent-entries').innerHTML = '<div class="empty-state">Sin movimientos todavía.</div>';
    $('#purchase-list').innerHTML = '<div class="empty-state">Cargando compras…</div>';
    $('#payment-list').innerHTML = '<div class="empty-state">Cargando pagos…</div>';
    $('#income-list').innerHTML = '<div class="empty-state">Sin ingresos registrados.</div>';
    $('#expense-list').innerHTML = '<div class="empty-state">Sin egresos registrados.</div>';
    closePaymentModal();
  }

  function resetForms() {
    $('#auth-form').reset();
    $('#purchase-form').reset();
    $('#income-form').reset();
    $('#expense-form').reset();
    $('#payment-form').reset();
    setFormDates();
    togglePurchaseScope();
  }

  function applyIdentityTheme() {
    const identity = currentIdentity();
    $('#user-email').textContent = identity.email;
    $('#identity-badge').textContent = identity.name;
    $('#identity-badge').className = `hidden rounded-full px-3 py-1 text-xs font-bold sm:inline-flex ${identity.theme === 'danny' ? 'bg-violet-500/15 text-violet-300' : 'bg-wine-500/15 text-red-300'}`;
    $('#brand-icon').className = `flex h-10 w-10 shrink-0 items-center justify-center rounded-xl font-black text-white ${identity.theme === 'danny' ? 'bg-gradient-to-br from-violet-500 to-purple-800' : 'bg-gradient-to-br from-red-600 to-wine-700'}`;
  }

  function switchTab(tabName) {
    $$('.tab-panel').forEach((panel) => panel.classList.toggle('hidden', panel.id !== `tab-${tabName}`));
    $$('[data-tab]').forEach((button) => button.classList.toggle('active', button.dataset.tab === tabName));
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function getPurchaseValues() {
    const totalCents = Math.round(Number($('#total-amount').value || 0) * 100);
    const initialCents = Math.round(Number($('#initial-amount').value || 0) * 100);
    const financedCents = totalCents - initialCents;
    const installments = Number($('#installments').value);
    const isShared = $('#purchase-scope').value === 'shared';
    let annyCents = 0;
    let dannyCents = 0;
    let splitType = 'personalizado';

    if (!isShared) {
      if (currentIdentity().person === 'Danny') dannyCents = financedCents;
      else annyCents = financedCents;
    } else if ($('#split-type').value === 'mitad') {
      splitType = 'mitad';
      dannyCents = Math.floor(financedCents / 2);
      annyCents = financedCents - dannyCents;
    } else {
      dannyCents = Math.round(Number($('#danny-debt').value || 0) * 100);
      annyCents = financedCents - dannyCents;
    }
    return { totalAmount: totalCents / 100, initialAmount: initialCents / 100, financed: financedCents / 100, annyDebt: annyCents / 100, dannyDebt: dannyCents / 100, installments, splitType, isShared };
  }

  function updatePurchasePreview() {
    const values = getPurchaseValues();
    $('#preview-financed').textContent = formatMoney(Math.max(0, values.financed));
    $('#preview-anny').textContent = formatMoney(Math.max(0, values.annyDebt) / values.installments);
    $('#preview-danny').textContent = formatMoney(Math.max(0, values.dannyDebt) / values.installments);
  }

  function togglePurchaseScope() {
    const isShared = $('#purchase-scope').value === 'shared';
    $('#shared-purchase-fields').classList.toggle('hidden', !isShared);
    $('#scope-help').textContent = isShared ? `Visible para ${pairEmails.anny} y ${pairEmails.danny}.` : 'Nadie más podrá ver esta compra.';
    toggleCustomSplit();
  }

  function toggleCustomSplit() {
    const custom = $('#purchase-scope').value === 'shared' && $('#split-type').value === 'personalizado';
    $('#danny-debt-wrap').classList.toggle('hidden', !custom);
    updatePurchasePreview();
  }

  const remaining = (purchase) => Math.max(0, Number(purchase.total_amount) - Number(purchase.initial_amount) - Number(purchase.total_paid));
  const personPending = (purchase, person) => Math.max(0, Number(person === 'Danny' ? purchase.danny_debt : purchase.anny_debt) - Number(person === 'Danny' ? purchase.danny_paid : purchase.anny_paid));

  async function loadData(version = state.sessionVersion) {
    if (!state.user) return;
    const refresh = $('#refresh-button');
    setButton(refresh, true, '…');
    const [purchasesResult, paymentsResult, entriesResult] = await Promise.all([
      state.db.from('purchases').select('id,user_id,created_at,purchase_date,product,category,store_name,mode,credit_line,total_amount,initial_amount,initial_paid_by,split_type,anny_debt,danny_debt,anny_paid,danny_paid,installments,notes,total_paid,status,is_shared').order('created_at', { ascending: false }),
      state.db.from('payments').select('id,user_id,purchase_id,created_at,paid_at,payer,amount,reference,receipt_url,purchases(product,is_shared,user_id)').order('created_at', { ascending: false }),
      state.db.from('private_entries').select('id,user_id,created_at,entry_date,entry_type,amount,category,description,notes').order('entry_date', { ascending: false }).order('created_at', { ascending: false })
    ]);
    setButton(refresh, false);
    if (version !== state.sessionVersion || !state.user) return;
    const error = purchasesResult.error || paymentsResult.error || entriesResult.error;
    if (error) {
      console.error(error);
      notify('No se pudieron cargar los datos. Ejecuta nuevamente supabase-setup.sql en Supabase.', 'error');
      return;
    }
    state.purchases = purchasesResult.data || [];
    state.payments = paymentsResult.data || [];
    state.entries = entriesResult.data || [];
    renderAll();
  }

  function renderAll() {
    renderDashboard();
    renderPurchases();
    renderPayments();
    renderEntries('ingreso');
    renderEntries('egreso');
  }

  function entryMarkup(entry, compact = false) {
    const isIncome = entry.entry_type === 'ingreso';
    return `<article class="entry-row"><div class="min-w-0"><div class="flex items-center gap-2"><span class="${isIncome ? 'text-emerald-400' : 'text-red-400'}">${isIncome ? '↗' : '↘'}</span><p class="truncate font-semibold">${escapeHtml(entry.description)}</p></div><p class="mt-1 text-xs text-slate-500">${escapeHtml(entry.category || 'Sin categoría')} · ${formatDate(entry.entry_date)}</p></div><div class="shrink-0 text-right"><strong class="${isIncome ? 'text-emerald-300' : 'text-red-300'}">${isIncome ? '+' : '−'}${formatMoney(entry.amount)}</strong>${compact ? '' : `<button data-delete-entry="${entry.id}" class="mt-1 block w-full text-xs text-slate-600 hover:text-red-300">Eliminar</button>`}</div></article>`;
  }

  function renderDashboard() {
    const incomes = state.entries.filter((entry) => entry.entry_type === 'ingreso');
    const expenses = state.entries.filter((entry) => entry.entry_type === 'egreso');
    const incomeTotal = incomes.reduce((sum, entry) => sum + Number(entry.amount), 0);
    const expenseTotal = expenses.reduce((sum, entry) => sum + Number(entry.amount), 0);
    const person = currentIdentity().person;
    const casheaTotal = state.purchases.filter((purchase) => purchase.status === 'activa').reduce((sum, purchase) => sum + personPending(purchase, person), 0);
    $('#wallet-balance').textContent = formatMoney(incomeTotal - expenseTotal);
    $('#income-total').textContent = formatMoney(incomeTotal);
    $('#expense-total').textContent = formatMoney(expenseTotal);
    $('#cashea-outstanding').textContent = formatMoney(casheaTotal);
    const recent = [...state.entries].sort((a, b) => `${b.entry_date}${b.created_at}`.localeCompare(`${a.entry_date}${a.created_at}`)).slice(0, 5);
    $('#recent-entries').innerHTML = recent.length ? recent.map((entry) => entryMarkup(entry, true)).join('') : '<div class="empty-state">Sin movimientos todavía.</div>';
  }

  function renderEntries(type) {
    const entries = state.entries.filter((entry) => entry.entry_type === type);
    const prefix = type === 'ingreso' ? 'income' : 'expense';
    $(`#${prefix}-list-total`).textContent = formatMoney(entries.reduce((sum, entry) => sum + Number(entry.amount), 0));
    $(`#${prefix}-list`).innerHTML = entries.length ? entries.map((entry) => entryMarkup(entry)).join('') : `<div class="empty-state">Sin ${type === 'ingreso' ? 'ingresos' : 'egresos'} registrados.</div>`;
  }

  function renderPurchases() {
    const active = state.purchases.filter((purchase) => purchase.status === 'activa');
    $('#purchase-badge').textContent = String(active.length);
    if (!active.length) {
      $('#purchase-list').innerHTML = '<div class="empty-state">No hay compras Cashea activas.</div>';
      return;
    }
    $('#purchase-list').innerHTML = active.map((purchase) => {
      const financed = Number(purchase.total_amount) - Number(purchase.initial_amount);
      const progress = financed > 0 ? Math.min(100, Math.round((Number(purchase.total_paid) / financed) * 100)) : 100;
      const shared = Boolean(purchase.is_shared);
      const ownerLabel = purchase.user_id === state.user.id ? 'Creada por mí' : `Compartida por ${currentIdentity().person === 'Anny' ? 'Danny' : 'Anny'}`;
      return `<article class="overflow-hidden rounded-2xl border ${shared ? 'border-violet-500/20' : 'border-wine-500/20'} bg-[#130d12] shadow-xl shadow-black/10"><div class="h-1 ${shared ? 'bg-gradient-to-r from-red-600 to-violet-600' : 'bg-gradient-to-r from-red-600 to-wine-700'}"></div><div class="p-5"><div class="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div><div class="mb-2 flex flex-wrap gap-2"><span class="rounded-full bg-white/5 px-2.5 py-1 text-xs text-slate-300">${escapeHtml(purchase.category || 'Sin categoría')}</span><span class="rounded-full px-2.5 py-1 text-xs font-bold ${shared ? 'bg-violet-500/10 text-violet-300' : 'bg-wine-500/10 text-red-300'}">${shared ? 'Anny + Danny' : 'Personal'}</span></div><h4 class="text-lg font-bold">${escapeHtml(purchase.product)}</h4><p class="mt-1 text-xs text-slate-500">${ownerLabel} · ${formatDate(purchase.purchase_date)}</p></div><div class="text-left sm:text-right"><p class="text-xs text-slate-500">Saldo total</p><strong class="text-xl ${shared ? 'text-violet-300' : 'text-red-300'}">${formatMoney(remaining(purchase))}</strong></div></div><div class="mt-5"><div class="mb-2 flex justify-between text-xs text-slate-500"><span>${formatMoney(purchase.total_paid)} pagado de ${formatMoney(financed)}</span><span>${progress}%</span></div><div class="h-2 overflow-hidden rounded-full bg-black/40"><div class="h-full rounded-full ${shared ? 'bg-gradient-to-r from-red-600 to-violet-600' : 'bg-gradient-to-r from-red-600 to-wine-500'}" style="width:${progress}%"></div></div></div><div class="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-black/20 p-3 text-sm"><div><span class="block text-xs text-red-400">Anny pendiente</span><strong>${formatMoney(personPending(purchase, 'Anny'))}</strong><span class="block text-[10px] text-slate-600">${formatMoney(Number(purchase.anny_debt) / Number(purchase.installments))} / cuota</span></div><div><span class="block text-xs text-violet-400">Danny pendiente</span><strong>${formatMoney(personPending(purchase, 'Danny'))}</strong><span class="block text-[10px] text-slate-600">${formatMoney(Number(purchase.danny_debt) / Number(purchase.installments))} / cuota</span></div></div><button data-pay-purchase="${purchase.id}" class="btn-primary mt-4 w-full">Registrar abono</button></div></article>`;
    }).join('');
  }

  function renderPayments() {
    $('#payment-list').innerHTML = state.payments.length ? state.payments.map((payment) => {
      const shared = Boolean(payment.purchases?.is_shared);
      return `<article class="entry-row"><div class="min-w-0"><div class="flex items-center gap-2"><span class="${payment.payer === 'Danny' ? 'text-violet-400' : 'text-red-400'}">●</span><p class="truncate font-semibold">${escapeHtml(payment.purchases?.product || 'Compra Cashea')}</p></div><p class="mt-1 text-xs text-slate-500">${escapeHtml(payment.payer)} · ${formatDate(payment.paid_at)}${payment.reference ? ` · Ref. ${escapeHtml(payment.reference)}` : ''} · ${shared ? 'Compartido' : 'Personal'}</p></div><strong class="shrink-0 ${payment.payer === 'Danny' ? 'text-violet-300' : 'text-red-300'}">${formatMoney(payment.amount)}</strong></article>`;
    }).join('') : '<div class="empty-state">Aún no hay pagos Cashea.</div>';
  }

  async function submitAuth(event) {
    event.preventDefault();
    const email = $('#auth-email').value.trim().toLowerCase();
    const password = $('#auth-password').value;
    if (![pairEmails.anny, pairEmails.danny].includes(email)) return notify('Esta aplicación sólo admite las cuentas de Anny y Danny.', 'error');
    const button = $('#auth-submit');
    setButton(button, true, state.creatingAccount ? 'Creando cuenta…' : 'Ingresando…');
    const result = state.creatingAccount ? await state.db.auth.signUp({ email, password, options: { emailRedirectTo: window.location.href } }) : await state.db.auth.signInWithPassword({ email, password });
    setButton(button, false);
    if (result.error) return notify(result.error.message, 'error');
    if (state.creatingAccount && !result.data.session) {
      $('#auth-password').value = '';
      return notify('Cuenta creada. Confirma el mensaje enviado a tu correo.');
    }
    notify(state.creatingAccount ? 'Cuenta creada correctamente.' : 'Sesión iniciada.');
  }

  async function submitPurchase(event) {
    event.preventDefault();
    const values = getPurchaseValues();
    if (values.totalAmount <= 0) return notify('Indica un monto total válido.', 'error');
    if (values.initialAmount < 0 || values.initialAmount >= values.totalAmount) return notify('La inicial debe ser menor que el monto total para que exista financiamiento Cashea.', 'error');
    if (values.dannyDebt < 0 || values.annyDebt < 0) return notify('La división supera el financiamiento disponible.', 'error');
    const person = currentIdentity().person;
    if (!person) return notify('Tu cuenta no está autorizada.', 'error');
    const button = $('#purchase-submit');
    setButton(button, true);
    const { error } = await state.db.from('purchases').insert({
      user_id: state.user.id, purchase_date: $('#purchase-date').value, product: $('#product').value.trim(), category: $('#category').value.trim(), store_name: $('#store').value.trim(), mode: $('#mode').value,
      credit_line: values.isShared ? $('#credit-line').value : person, total_amount: values.totalAmount.toFixed(2), initial_amount: values.initialAmount.toFixed(2), initial_paid_by: values.isShared ? $('#initial-payer').value : person,
      split_type: values.splitType, anny_debt: values.annyDebt.toFixed(2), danny_debt: values.dannyDebt.toFixed(2), installments: values.installments, notes: $('#notes').value.trim(), is_shared: values.isShared
    });
    setButton(button, false);
    if (error) return notify(error.message, 'error');
    event.target.reset();
    setFormDates();
    togglePurchaseScope();
    notify(values.isShared ? 'Compra compartida guardada.' : 'Compra personal guardada.');
    await loadData();
  }

  async function submitEntry(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const type = form.dataset.entryType;
    const amount = Number($('[name="entry-amount"]', form).value);
    if (!Number.isFinite(amount) || amount <= 0) return notify('Indica un monto válido.', 'error');
    const button = $('button[type="submit"]', form);
    setButton(button, true);
    const { error } = await state.db.from('private_entries').insert({ user_id: state.user.id, entry_date: $('[name="entry-date"]', form).value, entry_type: type, amount: amount.toFixed(2), category: $('[name="entry-category"]', form).value.trim(), description: $('[name="entry-description"]', form).value.trim(), notes: $('[name="entry-notes"]', form).value.trim() });
    setButton(button, false);
    if (error) return notify(error.message, 'error');
    form.reset();
    $('[name="entry-date"]', form).value = today();
    notify(type === 'ingreso' ? 'Ingreso privado guardado.' : 'Egreso privado guardado.');
    await loadData();
  }

  async function deleteEntry(entryId) {
    if (!window.confirm('¿Quieres eliminar este movimiento privado?')) return;
    const { error } = await state.db.from('private_entries').delete().eq('id', entryId);
    if (error) return notify(error.message, 'error');
    notify('Movimiento eliminado.');
    await loadData();
  }

  function updatePaymentLimit() {
    const purchase = state.purchases.find((item) => item.id === $('#payment-purchase-id').value);
    if (!purchase) return;
    const pending = personPending(purchase, $('#payment-payer').value);
    $('#payment-amount').max = pending.toFixed(2);
    $('#payment-purchase-name').textContent = `${purchase.product} · ${$('#payment-payer').value} debe ${formatMoney(pending)}`;
  }

  function openPaymentModal(purchaseId) {
    const purchase = state.purchases.find((item) => item.id === purchaseId);
    if (!purchase) return;
    const shared = Boolean(purchase.is_shared);
    $('#payment-purchase-id').value = purchase.id;
    $('#payment-scope-badge').textContent = shared ? 'Compartida · Anny y Danny' : 'Personal · sólo tú';
    $('#payment-scope-badge').className = `mt-2 inline-flex rounded-full px-2.5 py-1 text-xs font-bold ${shared ? 'bg-violet-500/10 text-violet-300' : 'bg-wine-500/10 text-red-300'}`;
    $('#payment-payer').value = currentIdentity().person;
    $('#payment-payer').disabled = !shared;
    $('#payment-amount').value = '';
    $('#payment-reference').value = '';
    $('#receipt-url').value = '';
    $('#payment-date').value = today();
    updatePaymentLimit();
    $('#payment-modal').classList.remove('hidden');
    $('#payment-modal').classList.add('flex');
  }

  async function submitPayment(event) {
    event.preventDefault();
    const amount = Number($('#payment-amount').value);
    const max = Number($('#payment-amount').max);
    if (!Number.isFinite(amount) || amount <= 0) return notify('Indica un monto de pago válido.', 'error');
    if (amount > max) return notify(`El abono supera el saldo de ${$('#payment-payer').value}.`, 'error');
    const button = $('#payment-submit');
    setButton(button, true);
    const { error } = await state.db.rpc('record_payment', { p_purchase_id: $('#payment-purchase-id').value, p_payer: $('#payment-payer').value, p_amount: amount, p_reference: $('#payment-reference').value.trim() || null, p_paid_at: $('#payment-date').value, p_receipt_url: $('#receipt-url').value.trim() || null });
    setButton(button, false);
    if (error) return notify(error.message, 'error');
    closePaymentModal();
    notify('Pago guardado y saldo actualizado.');
    await loadData();
  }

  function setFormDates() {
    $('#purchase-date').value = today();
    $('#payment-date').value = today();
    $('#income-date').value = today();
    $('#expense-date').value = today();
    $('#initial-amount').value = $('#initial-amount').value || '0';
  }

  async function applySession(session) {
    const version = ++state.sessionVersion;
    clearAccountData();
    resetForms();
    state.user = session?.user || null;
    if (!state.user) return showApp(false);
    if (!currentIdentity().isMember) {
      state.user = null;
      showApp(false);
      await state.db.auth.signOut();
      notify('Esta cuenta no está autorizada para usar Finanzas MF.', 'error');
      return;
    }
    applyIdentityTheme();
    showApp(true);
    await loadData(version);
  }

  async function logout() {
    ++state.sessionVersion;
    state.user = null;
    clearAccountData();
    resetForms();
    showApp(false);
    const { error } = await state.db.auth.signOut();
    if (error) return notify(`No se pudo cerrar la sesión: ${error.message}`, 'error');
    notify('Sesión cerrada.');
  }

  function bindEvents() {
    $('#auth-form').addEventListener('submit', submitAuth);
    $('#auth-toggle').addEventListener('click', () => {
      state.creatingAccount = !state.creatingAccount;
      $('#auth-submit').textContent = state.creatingAccount ? 'Crear cuenta' : 'Iniciar sesión';
      $('#auth-submit').dataset.originalText = $('#auth-submit').textContent;
      $('#auth-toggle').textContent = state.creatingAccount ? 'Ya tengo una cuenta' : 'Crear una cuenta';
      $('#auth-help').textContent = state.creatingAccount ? 'Debes confirmar el correo recibido antes de ingresar.' : 'Cada cuenta mantiene privados sus ingresos y egresos.';
    });
    $('#logout-button').addEventListener('click', logout);
    $('#refresh-button').addEventListener('click', () => loadData());
    $$('[data-tab]').forEach((button) => button.addEventListener('click', () => switchTab(button.dataset.tab)));
    $('#purchase-form').addEventListener('submit', submitPurchase);
    $('#purchase-scope').addEventListener('change', togglePurchaseScope);
    $('#split-type').addEventListener('change', toggleCustomSplit);
    ['#total-amount', '#initial-amount', '#danny-debt', '#installments'].forEach((selector) => $(selector).addEventListener('input', updatePurchasePreview));
    $$('.entry-form').forEach((form) => form.addEventListener('submit', submitEntry));
    $('#purchase-list').addEventListener('click', (event) => { const button = event.target.closest('[data-pay-purchase]'); if (button) openPaymentModal(button.dataset.payPurchase); });
    ['#income-list', '#expense-list'].forEach((selector) => $(selector).addEventListener('click', (event) => { const button = event.target.closest('[data-delete-entry]'); if (button) deleteEntry(button.dataset.deleteEntry); }));
    $('#payment-payer').addEventListener('change', updatePaymentLimit);
    $('#close-payment-modal').addEventListener('click', closePaymentModal);
    $('#payment-modal').addEventListener('click', (event) => { if (event.target.id === 'payment-modal') closePaymentModal(); });
    $('#payment-form').addEventListener('submit', submitPayment);
  }

  async function initialize() {
    try {
      validateConfig();
      bindEvents();
      setFormDates();
      togglePurchaseScope();
      const { data: { session } } = await state.db.auth.getSession();
      await applySession(session);
      state.db.auth.onAuthStateChange((_event, nextSession) => window.setTimeout(() => applySession(nextSession), 0));
    } catch (error) {
      console.error(error);
      notify(error.message || 'No fue posible iniciar la aplicación.', 'error');
    }
  }

  initialize();
})();
