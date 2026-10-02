(() => {
  'use strict';

  const config = window.FINANZAS_CONFIG;
  const money = new Intl.NumberFormat('es-VE', { style: 'currency', currency: 'USD' });
  const $ = (selector) => document.querySelector(selector);
  const state = { db: null, user: null, purchases: [], payments: [], creatingAccount: false };

  function today() {
    return new Date().toISOString().slice(0, 10);
  }

  function formatMoney(value) {
    return money.format(Number(value || 0));
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char]));
  }

  function notify(message, type = 'success') {
    const notice = $('#notice');
    notice.textContent = message;
    notice.className = `fixed right-4 top-4 z-50 max-w-sm rounded-xl border px-4 py-3 text-sm shadow-2xl ${type === 'error' ? 'border-rose-400/40 bg-rose-950 text-rose-100' : 'border-emerald-400/40 bg-emerald-950 text-emerald-100'}`;
    clearTimeout(notify.timeout);
    notify.timeout = setTimeout(() => notice.classList.add('hidden'), 4500);
  }

  function setButton(button, loading, loadingText) {
    if (!button.dataset.text) button.dataset.text = button.textContent;
    button.disabled = loading;
    button.textContent = loading ? loadingText : button.dataset.text;
  }

  function showApp(isLoggedIn) {
    $('#auth-view').classList.toggle('hidden', isLoggedIn);
    $('#app-view').classList.toggle('hidden', !isLoggedIn);
  }

  function validateConfig() {
    if (!config?.supabaseUrl || !config?.supabasePublishableKey || config.supabaseUrl.includes('/rest/v1')) {
      throw new Error('Falta configurar Supabase. Revisa config.js y usa la URL raíz del proyecto, sin /rest/v1/.');
    }
    state.db = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey);
  }

  function getPurchaseValues() {
    const totalAmount = Number($('#total-amount').value);
    const initialAmount = Number($('#initial-amount').value || 0);
    const installments = Number($('#installments').value);
    const splitType = $('#split-type').value;
    const financed = totalAmount - initialAmount;
    const dannyDebt = splitType === 'mitad' ? financed / 2 : Number($('#danny-debt').value || 0);
    const annyDebt = financed - dannyDebt;
    return { totalAmount, initialAmount, installments, splitType, financed, dannyDebt, annyDebt };
  }

  function updatePreview() {
    const { financed, annyDebt, dannyDebt, installments } = getPurchaseValues();
    $('#preview-financed').textContent = formatMoney(Math.max(0, financed));
    $('#preview-anny').textContent = formatMoney(Math.max(0, annyDebt) / installments);
    $('#preview-danny').textContent = formatMoney(Math.max(0, dannyDebt) / installments);
  }

  function toggleCustomSplit() {
    const isCustom = $('#split-type').value === 'personalizado';
    $('#danny-debt-wrap').classList.toggle('hidden', !isCustom);
    updatePreview();
  }

  async function loadData() {
    const refresh = $('#refresh-button');
    setButton(refresh, true, 'Actualizando…');
    const [purchasesResult, paymentsResult] = await Promise.all([
      state.db.from('purchases').select('*').order('created_at', { ascending: false }),
      state.db.from('payments').select('*, purchases(product)').order('created_at', { ascending: false })
    ]);
    setButton(refresh, false);

    if (purchasesResult.error || paymentsResult.error) {
      console.error(purchasesResult.error || paymentsResult.error);
      notify('No se pudieron cargar los datos. Ejecuta supabase-setup.sql y verifica tu sesión.', 'error');
      return;
    }
    state.purchases = purchasesResult.data;
    state.payments = paymentsResult.data;
    render();
  }

  function remaining(purchase) {
    return Math.max(0, Number(purchase.total_amount) - Number(purchase.initial_amount) - Number(purchase.total_paid));
  }

  function render() {
    const active = state.purchases.filter((purchase) => purchase.status === 'activa');
    const outstanding = active.reduce((sum, purchase) => sum + remaining(purchase), 0);
    const paid = state.purchases.reduce((sum, purchase) => sum + Number(purchase.total_paid), 0);
    $('#active-count').textContent = active.length;
    $('#purchase-badge').textContent = active.length;
    $('#outstanding-total').textContent = formatMoney(outstanding);
    $('#paid-total').textContent = formatMoney(paid);

    const list = $('#purchase-list');
    if (!active.length) {
      list.innerHTML = '<div class="empty-state">No tienes compras activas. Registra la primera desde el formulario.</div>';
    } else {
      list.innerHTML = active.map((purchase) => {
        const financed = Number(purchase.total_amount) - Number(purchase.initial_amount);
        const balance = remaining(purchase);
        const progress = financed ? Math.min(100, Math.round((Number(purchase.total_paid) / financed) * 100)) : 100;
        const annyInstallment = Number(purchase.anny_debt) / Number(purchase.installments);
        const dannyInstallment = Number(purchase.danny_debt) / Number(purchase.installments);
        return `<article class="rounded-2xl border border-slate-800 bg-slate-900 p-5 shadow-xl shadow-black/10">
          <div class="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
            <div><div class="mb-2 flex flex-wrap gap-2"><span class="rounded-full bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-300">${escapeHtml(purchase.category || 'Sin categoría')}</span><span class="rounded-full ${purchase.credit_line === 'Anny' ? 'bg-rose-500/10 text-rose-300' : 'bg-violet-500/10 text-violet-300'} px-2.5 py-1 text-xs font-medium">Línea: ${escapeHtml(purchase.credit_line)}</span></div><h4 class="text-lg font-bold text-white">${escapeHtml(purchase.product)}</h4><p class="mt-1 text-sm text-slate-400">${escapeHtml(purchase.store_name || 'Sin tienda')} · ${escapeHtml(purchase.purchase_date)}</p></div>
            <div class="text-left sm:text-right"><p class="text-xs text-slate-400">Saldo pendiente</p><strong class="text-xl text-emerald-300">${formatMoney(balance)}</strong></div>
          </div>
          <div class="mt-5"><div class="mb-2 flex justify-between text-xs text-slate-400"><span>${formatMoney(purchase.total_paid)} pagado de ${formatMoney(financed)}</span><span>${progress}%</span></div><div class="h-2 overflow-hidden rounded-full bg-slate-800"><div class="h-full rounded-full bg-gradient-to-r from-emerald-400 to-cyan-500" style="width:${progress}%"></div></div></div>
          <div class="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-slate-950/70 p-3 text-sm"><div><span class="block text-xs text-slate-500">Anny / cuota</span><strong>${formatMoney(annyInstallment)}</strong></div><div><span class="block text-xs text-slate-500">Danny / cuota</span><strong>${formatMoney(dannyInstallment)}</strong></div></div>
          <button data-pay-purchase="${purchase.id}" class="payment-button btn-primary mt-4 w-full">Registrar abono</button>
        </article>`;
      }).join('');
    }

    const paymentList = $('#payment-list');
    if (!state.payments.length) {
      paymentList.innerHTML = '<div class="empty-state">Aún no hay pagos registrados.</div>';
    } else {
      paymentList.innerHTML = state.payments.map((payment) => `<article class="flex items-center justify-between gap-3 rounded-xl border border-slate-800 bg-slate-900 p-4"><div><p class="font-semibold">${escapeHtml(payment.purchases?.product || 'Compra eliminada')}</p><p class="mt-1 text-xs text-slate-400">${escapeHtml(payment.payer)} · ${escapeHtml(payment.paid_at)}${payment.reference ? ` · Ref. ${escapeHtml(payment.reference)}` : ''}</p></div><strong class="text-emerald-300">${formatMoney(payment.amount)}</strong></article>`).join('');
    }
  }

  async function submitAuth(event) {
    event.preventDefault();
    const email = $('#auth-email').value.trim();
    const password = $('#auth-password').value;
    const button = $('#auth-submit');
    setButton(button, true, state.creatingAccount ? 'Creando cuenta…' : 'Ingresando…');
    const result = state.creatingAccount
      ? await state.db.auth.signUp({ email, password, options: { emailRedirectTo: window.location.href } })
      : await state.db.auth.signInWithPassword({ email, password });
    setButton(button, false);
    if (result.error) return notify(result.error.message, 'error');
    if (state.creatingAccount && !result.data.session) {
      notify('Cuenta creada. Revisa tu correo para confirmarla antes de iniciar sesión.');
      return;
    }
    notify(state.creatingAccount ? 'Cuenta creada correctamente.' : 'Sesión iniciada.');
  }

  async function submitPurchase(event) {
    event.preventDefault();
    const values = getPurchaseValues();
    if (!Number.isFinite(values.totalAmount) || values.totalAmount <= 0) return notify('Indica un monto total válido.', 'error');
    if (values.initialAmount < 0 || values.initialAmount > values.totalAmount) return notify('La inicial debe estar entre $0 y el monto total.', 'error');
    if (values.dannyDebt < 0 || values.dannyDebt > values.financed) return notify('La deuda de Danny no puede superar el financiamiento.', 'error');

    const button = $('#purchase-submit');
    setButton(button, true, 'Guardando…');
    const { error } = await state.db.from('purchases').insert({
      user_id: state.user.id,
      purchase_date: $('#purchase-date').value,
      product: $('#product').value.trim(),
      category: $('#category').value.trim(),
      store_name: $('#store').value.trim(),
      mode: $('#mode').value,
      credit_line: $('#credit-line').value,
      total_amount: values.totalAmount.toFixed(2),
      initial_amount: values.initialAmount.toFixed(2),
      initial_paid_by: $('#initial-payer').value,
      split_type: values.splitType,
      anny_debt: values.annyDebt.toFixed(2),
      danny_debt: values.dannyDebt.toFixed(2),
      installments: values.installments,
      notes: $('#notes').value.trim()
    });
    setButton(button, false);
    if (error) return notify(error.message, 'error');
    event.target.reset();
    $('#purchase-date').value = today();
    $('#initial-amount').value = '0';
    toggleCustomSplit();
    notify('Compra guardada.');
    await loadData();
  }

  function openPaymentModal(purchaseId) {
    const purchase = state.purchases.find((item) => item.id === purchaseId);
    if (!purchase) return;
    $('#payment-purchase-id').value = purchase.id;
    $('#payment-purchase-name').textContent = `${purchase.product} · Saldo: ${formatMoney(remaining(purchase))}`;
    $('#payment-amount').max = remaining(purchase).toFixed(2);
    $('#payment-amount').value = '';
    $('#payment-reference').value = '';
    $('#receipt-url').value = '';
    $('#payment-date').value = today();
    $('#payment-modal').classList.remove('hidden');
    $('#payment-modal').classList.add('flex');
  }

  function closePaymentModal() {
    $('#payment-modal').classList.add('hidden');
    $('#payment-modal').classList.remove('flex');
  }

  async function submitPayment(event) {
    event.preventDefault();
    const purchaseId = $('#payment-purchase-id').value;
    const amount = Number($('#payment-amount').value);
    if (!Number.isFinite(amount) || amount <= 0) return notify('Indica un monto de pago válido.', 'error');
    const button = $('#payment-submit');
    setButton(button, true, 'Guardando…');
    const { error } = await state.db.rpc('record_payment', {
      p_purchase_id: purchaseId,
      p_payer: $('#payment-payer').value,
      p_amount: amount,
      p_reference: $('#payment-reference').value.trim() || null,
      p_paid_at: $('#payment-date').value,
      p_receipt_url: $('#receipt-url').value.trim() || null
    });
    setButton(button, false);
    if (error) return notify(error.message, 'error');
    closePaymentModal();
    notify('Pago guardado y saldo actualizado.');
    await loadData();
  }

  async function initialize() {
    try {
      validateConfig();
      $('#purchase-date').value = today();
      $('#payment-date').value = today();
      const { data: { session } } = await state.db.auth.getSession();
      state.user = session?.user || null;
      if (state.user) {
        showApp(true);
        $('#user-email').textContent = state.user.email;
        await loadData();
      }
      state.db.auth.onAuthStateChange(async (_event, session) => {
        state.user = session?.user || null;
        showApp(Boolean(state.user));
        if (state.user) {
          $('#user-email').textContent = state.user.email;
          await loadData();
        }
      });
    } catch (error) {
      console.error(error);
      notify(error.message || 'No fue posible iniciar la aplicación.', 'error');
    }
  }

  $('#auth-form').addEventListener('submit', submitAuth);
  $('#auth-toggle').addEventListener('click', () => {
    state.creatingAccount = !state.creatingAccount;
    $('#auth-submit').textContent = state.creatingAccount ? 'Crear cuenta' : 'Iniciar sesión';
    $('#auth-toggle').textContent = state.creatingAccount ? 'Ya tengo una cuenta' : 'Crear una cuenta';
    $('#auth-help').textContent = state.creatingAccount ? 'Recibirás un correo de confirmación si está activado en Supabase.' : 'Tu información se guarda de forma privada en tu cuenta.';
  });
  $('#logout-button').addEventListener('click', async () => { await state.db.auth.signOut(); notify('Sesión cerrada.'); });
  $('#refresh-button').addEventListener('click', loadData);
  $('#purchase-form').addEventListener('submit', submitPurchase);
  ['#total-amount', '#initial-amount', '#danny-debt', '#installments'].forEach((selector) => $(selector).addEventListener('input', updatePreview));
  $('#split-type').addEventListener('change', toggleCustomSplit);
  $('#purchase-list').addEventListener('click', (event) => { const button = event.target.closest('[data-pay-purchase]'); if (button) openPaymentModal(button.dataset.payPurchase); });
  $('#close-payment-modal').addEventListener('click', closePaymentModal);
  $('#payment-modal').addEventListener('click', (event) => { if (event.target.id === 'payment-modal') closePaymentModal(); });
  $('#payment-form').addEventListener('submit', submitPayment);
  initialize();
})();
