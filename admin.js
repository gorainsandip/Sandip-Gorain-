import {
  db, auth, storage, SUPER_ADMIN_EMAIL,
  collection, doc, getDoc, getDocs, addDoc, updateDoc, deleteDoc, setDoc,
  onSnapshot, query, orderBy, serverTimestamp,
  GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged,
  ref, uploadBytes, getDownloadURL, deleteObject
} from "./firebase-config.js";

const $ = (s) => document.querySelector(s);
let IS_SUPER = false;
let PRODUCTS = [];
let ORDERS = [];
let ordersUnsub = null;
let firstOrdersLoad = true;
let editingProductId = null;
let pendingImageFiles = []; // {file, url} for new uploads
let existingImages = [];    // urls already saved (when editing)

// ---------------- notification sound ----------------
function playNotificationSound(){
  try{
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const now = ctx.currentTime;
    [880, 1175].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now + i * 0.16);
      gain.gain.exponentialRampToValueAtTime(0.4, now + i * 0.16 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.16 + 0.3);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(now + i * 0.16);
      osc.stop(now + i * 0.16 + 0.32);
    });
  }catch(e){ console.warn("sound failed", e); }
}

function notifyBrowser(title, body){
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted"){
    new Notification(title, { body });
  }
}

// ---------------- auth ----------------
$("#googleLoginBtn").addEventListener("click", async () => {
  const provider = new GoogleAuthProvider();
  try{
    await signInWithPopup(auth, provider);
  }catch(e){
    alert("লগইন ব্যর্থ হয়েছে: " + e.message);
  }
});

$("#logoutBtn").addEventListener("click", () => signOut(auth));

onAuthStateChanged(auth, async (user) => {
  if (!user){
    showLogin();
    return;
  }
  const email = user.email;
  const allowed = await checkAccess(email);
  if (!allowed){
    alert("এই ইমেইল দিয়ে অ্যাডমিন প্যানেলে ঢোকার অনুমতি নেই।");
    await signOut(auth);
    showLogin();
    return;
  }
  IS_SUPER = (email === SUPER_ADMIN_EMAIL);
  $("#adminEmailTag").textContent = email + (IS_SUPER ? " · সুপার অ্যাডমিন" : " · অ্যাডমিন");
  if (IS_SUPER) $("#navAdmins").style.display = "block";
  if ("Notification" in window && Notification.permission === "default"){
    Notification.requestPermission();
  }
  showApp();
  loadProducts();
  listenOrders();
  if (IS_SUPER) loadAdmins();
});

async function checkAccess(email){
  if (email === SUPER_ADMIN_EMAIL) return true;
  try{
    const snap = await getDoc(doc(db, "admins", email));
    return snap.exists();
  }catch(e){
    console.error(e);
    return false;
  }
}

function showLogin(){
  $("#loginView").style.display = "flex";
  $("#appView").style.display = "none";
  if (ordersUnsub) { ordersUnsub(); ordersUnsub = null; }
}
function showApp(){
  $("#loginView").style.display = "none";
  $("#appView").style.display = "flex";
}

// ---------------- nav ----------------
document.querySelectorAll(".admin-nav button[data-tab]").forEach(btn => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});
function switchTab(tab){
  document.querySelectorAll(".admin-nav button[data-tab]").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
  document.querySelectorAll(".tab-panel").forEach(p => p.style.display = (p.id === "tab-" + tab) ? "block" : "none");
}

// ---------------- products ----------------
async function loadProducts(){
  const snap = await getDocs(collection(db, "products"));
  PRODUCTS = [];
  snap.forEach(d => PRODUCTS.push({ id: d.id, ...d.data() }));
  renderProductsTable();
}

function money(n){ return "৳" + Number(n || 0).toLocaleString("en-IN"); }

function renderProductsTable(){
  const body = $("#productsTableBody");
  if (!PRODUCTS.length){
    body.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--muted);padding:30px">কোনো প্রোডাক্ট নেই</td></tr>`;
    return;
  }
  body.innerHTML = PRODUCTS.map(p => `
    <tr>
      <td>${p.images && p.images[0] ? `<img class="prod-thumb" src="${p.images[0]}">` : `<div class="prod-thumb"></div>`}</td>
      <td>${escapeHtml(p.name || "")}</td>
      <td>${money(p.price)}${p.oldPrice ? `<br><span style="color:var(--muted);text-decoration:line-through;font-size:12px">${money(p.oldPrice)}</span>` : ""}</td>
      <td>${p.stock !== null && p.stock !== undefined ? p.stock : "সীমাহীন"}</td>
      <td>${p.active === false ? "লুকানো" : "প্রদর্শিত"}</td>
      <td>
        <button class="btn-secondary" data-edit="${p.id}" style="margin-right:6px;">এডিট</button>
        <button class="btn-danger" data-del="${p.id}">ডিলিট</button>
      </td>
    </tr>
  `).join("");

  body.querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", () => openProductForm(b.dataset.edit)));
  body.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => deleteProduct(b.dataset.del)));
}

function escapeHtml(str){
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

$("#newProductBtn").addEventListener("click", () => openProductForm(null));
$("#closeProductForm").addEventListener("click", closeProductForm);
$("#productFormOverlay").addEventListener("click", (e) => { if (e.target.id === "productFormOverlay") closeProductForm(); });

function openProductForm(id){
  editingProductId = id;
  pendingImageFiles = [];
  const p = id ? PRODUCTS.find(x => x.id === id) : null;
  existingImages = (p && p.images) ? [...p.images] : [];

  $("#pfTitle").textContent = id ? "প্রোডাক্ট এডিট করুন" : "নতুন প্রোডাক্ট";
  $("#pfName").value = p?.name || "";
  $("#pfPrice").value = p?.price ?? "";
  $("#pfOldPrice").value = p?.oldPrice ?? "";
  $("#pfStock").value = (p && p.stock !== null && p.stock !== undefined) ? p.stock : "";
  $("#pfDesc").value = p?.description || "";
  $("#pfActive").checked = p ? (p.active !== false) : true;
  $("#pfDeleteBtn").style.display = id ? "inline-block" : "none";
  renderImageThumbs();
  $("#productFormOverlay").classList.add("open");
}
function closeProductForm(){
  $("#productFormOverlay").classList.remove("open");
}

$("#pfImageInput").addEventListener("change", (e) => {
  const files = Array.from(e.target.files || []);
  files.forEach(file => {
    pendingImageFiles.push({ file, url: URL.createObjectURL(file) });
  });
  renderImageThumbs();
  e.target.value = "";
});

function renderImageThumbs(){
  const wrap = $("#pfImageThumbs");
  const existing = existingImages.map((url, i) => `
    <div class="it" data-existing="${i}"><img src="${url}"><button type="button" class="rm" data-rm-existing="${i}">✕</button></div>
  `).join("");
  const pending = pendingImageFiles.map((f, i) => `
    <div class="it" data-pending="${i}"><img src="${f.url}"><button type="button" class="rm" data-rm-pending="${i}">✕</button></div>
  `).join("");
  wrap.innerHTML = existing + pending;
  wrap.querySelectorAll("[data-rm-existing]").forEach(b => b.addEventListener("click", () => {
    existingImages.splice(Number(b.dataset.rmExisting), 1); renderImageThumbs();
  }));
  wrap.querySelectorAll("[data-rm-pending]").forEach(b => b.addEventListener("click", () => {
    pendingImageFiles.splice(Number(b.dataset.rmPending), 1); renderImageThumbs();
  }));
}

$("#productForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("#pfName").value.trim();
  const price = $("#pfPrice").value;
  if (!name || price === ""){
    alert("প্রোডাক্টের নাম ও বর্তমান দাম আবশ্যক");
    return;
  }
  const saveBtn = $("#pfSaveBtn");
  saveBtn.disabled = true; saveBtn.textContent = "সেভ হচ্ছে...";

  try{
    // upload new images
    const uploadedUrls = [];
    for (const f of pendingImageFiles){
      const path = `products/${Date.now()}_${Math.random().toString(36).slice(2)}_${f.file.name}`;
      const r = ref(storage, path);
      await uploadBytes(r, f.file);
      const url = await getDownloadURL(r);
      uploadedUrls.push(url);
    }
    const images = [...existingImages, ...uploadedUrls];

    const data = {
      name,
      price: Number(price),
      oldPrice: $("#pfOldPrice").value !== "" ? Number($("#pfOldPrice").value) : null,
      stock: $("#pfStock").value !== "" ? Number($("#pfStock").value) : null,
      description: $("#pfDesc").value.trim() || "",
      images,
      active: $("#pfActive").checked,
    };

    if (editingProductId){
      await updateDoc(doc(db, "products", editingProductId), data);
    } else {
      data.createdAt = serverTimestamp();
      await addDoc(collection(db, "products"), data);
    }
    closeProductForm();
    await loadProducts();
  }catch(err){
    console.error(err);
    alert("সেভ করতে সমস্যা হয়েছে: " + err.message);
  }finally{
    saveBtn.disabled = false; saveBtn.textContent = "সেভ করুন";
  }
});

$("#pfDeleteBtn").addEventListener("click", async () => {
  if (!editingProductId) return;
  if (!confirm("প্রোডাক্টটি ডিলিট করতে চান?")) return;
  await deleteProduct(editingProductId);
  closeProductForm();
});

async function deleteProduct(id){
  if (!confirm("প্রোডাক্টটি ডিলিট করতে চান? এটি ফিরিয়ে আনা যাবে না।")) return;
  await deleteDoc(doc(db, "products", id));
  await loadProducts();
}

// ---------------- orders ----------------
function listenOrders(){
  const q = query(collection(db, "orders"), orderBy("createdAt", "desc"));
  ordersUnsub = onSnapshot(q, (snap) => {
    const changes = snap.docChanges();
    const newOnes = changes.filter(c => c.type === "added");
    ORDERS = [];
    snap.forEach(d => ORDERS.push({ id: d.id, ...d.data() }));
    renderOrders(newOnes.map(c => c.doc.id));

    if (!firstOrdersLoad && newOnes.length){
      playNotificationSound();
      notifyBrowser("নতুন অর্ডার এসেছে!", `${newOnes.length}টি নতুন অর্ডার`);
      $("#navOrders").querySelector(".badge-dot")?.remove();
      const dot = document.createElement("span");
      dot.className = "badge-dot";
      $("#navOrders").appendChild(dot);
    }
    firstOrdersLoad = false;
  }, (err) => console.error("orders listen error", err));
}

function statusLabel(s){
  return { pending:"নতুন", confirmed:"কনফার্মড", shipped:"পাঠানো হয়েছে", delivered:"ডেলিভার হয়েছে", cancelled:"বাতিল" }[s] || s;
}

function renderOrders(newIds){
  const wrap = $("#ordersList");
  if (!ORDERS.length){
    wrap.innerHTML = `<div class="empty-state">এখনো কোনো অর্ডার আসেনি</div>`;
    return;
  }
  wrap.innerHTML = ORDERS.map(o => {
    const isNew = newIds.includes(o.id);
    const dt = o.createdAt?.toDate ? o.createdAt.toDate().toLocaleString("bn-BD") : "";
    return `
    <div class="order-card ${isNew ? "is-new" : ""}" data-id="${o.id}">
      <div class="order-card-head" data-toggle="${o.id}">
        <div>
          <strong>${escapeHtml(o.customer?.name || "অজানা")}</strong> · ${escapeHtml(o.customer?.phone || "")}
          <div style="font-size:12px;color:var(--muted)">${dt}</div>
        </div>
        <div style="text-align:right">
          <div><strong>${money(o.total)}</strong></div>
          <span class="status-pill status-${o.status}">${statusLabel(o.status)}</span>
        </div>
      </div>
      <div class="order-card-body" id="body-${o.id}">
        <p style="font-size:13px;color:var(--muted);margin-top:0">ঠিকানা: ${escapeHtml(o.customer?.address || "")}</p>
        ${o.customer?.note ? `<p style="font-size:13px;color:var(--muted)">নোট: ${escapeHtml(o.customer.note)}</p>` : ""}
        ${(o.items || []).map(it => `
          <div class="order-item-row">
            <span>${escapeHtml(it.name)} × ${it.qty}</span>
            <span>${money(it.qty * it.price)}</span>
          </div>
        `).join("")}
        <div class="field" style="margin-top:14px;">
          <label>স্ট্যাটাস পরিবর্তন করুন</label>
          <select data-status-for="${o.id}">
            ${["pending","confirmed","shipped","delivered","cancelled"].map(s => `<option value="${s}" ${o.status===s?"selected":""}>${statusLabel(s)}</option>`).join("")}
          </select>
        </div>
      </div>
    </div>`;
  }).join("");

  wrap.querySelectorAll("[data-toggle]").forEach(el => {
    el.addEventListener("click", () => {
      document.getElementById("body-" + el.dataset.toggle).classList.toggle("open");
      // clear "new" highlight once opened
      el.closest(".order-card").classList.remove("is-new");
    });
  });
  wrap.querySelectorAll("[data-status-for]").forEach(sel => {
    sel.addEventListener("click", (e) => e.stopPropagation());
    sel.addEventListener("change", async () => {
      await updateDoc(doc(db, "orders", sel.dataset.statusFor), { status: sel.value });
    });
  });
}

// ---------------- admins (super admin only) ----------------
async function loadAdmins(){
  const snap = await getDocs(collection(db, "admins"));
  const list = [];
  snap.forEach(d => list.push({ email: d.id, ...d.data() }));
  renderAdmins(list);
}

function renderAdmins(list){
  const wrap = $("#adminsList");
  const rows = [
    `<div class="cart-line" style="border-bottom:1px solid var(--line)">
      <div class="meta"><div class="name">${SUPER_ADMIN_EMAIL}</div><div style="font-size:12px;color:var(--muted)">সুপার অ্যাডমিন (স্থায়ী)</div></div>
    </div>`,
    ...list.map(a => `
      <div class="cart-line" style="border-bottom:1px solid var(--line)">
        <div class="meta">
          <div class="name">${escapeHtml(a.email)}</div>
          <div class="row2"><span style="font-size:12px;color:var(--muted)">অ্যাডমিন</span>
            <button class="btn-danger" data-rm-admin="${a.email}">রিমুভ করুন</button>
          </div>
        </div>
      </div>
    `)
  ];
  wrap.innerHTML = rows.join("");
  wrap.querySelectorAll("[data-rm-admin]").forEach(b => {
    b.addEventListener("click", async () => {
      if (!confirm(b.dataset.rmAdmin + " কে অ্যাডমিন থেকে বাদ দিতে চান?")) return;
      await deleteDoc(doc(db, "admins", b.dataset.rmAdmin));
      loadAdmins();
    });
  });
}

$("#addAdminForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = $("#newAdminEmail").value.trim().toLowerCase();
  if (!email) return;
  if (email === SUPER_ADMIN_EMAIL){
    alert("এই ইমেইল আগে থেকেই সুপার অ্যাডমিন।");
    return;
  }
  await setDoc(doc(db, "admins", email), { addedAt: serverTimestamp(), addedBy: auth.currentUser.email });
  $("#newAdminEmail").value = "";
  loadAdmins();
});
