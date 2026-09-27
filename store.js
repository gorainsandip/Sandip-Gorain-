import {
  db, collection, getDocs, addDoc, query, where, serverTimestamp
} from "./firebase-config.js";

let PRODUCTS = [];
let CART = {}; // { productId: {product, qty} }
let currentProduct = null;
let currentImgIndex = 0;

const $ = (sel) => document.querySelector(sel);
const grid = $("#grid");
const emptyState = $("#emptyState");

// ---------- load products ----------
async function loadProducts(){
  try{
    const q = query(collection(db, "products"), where("active", "!=", false));
    const snap = await getDocs(q);
    PRODUCTS = [];
    snap.forEach(d => PRODUCTS.push({ id: d.id, ...d.data() }));
  }catch(e){
    // ফলব্যাক: যদি 'active' ফিল্ড না থাকা প্রোডাক্টের জন্য কোয়েরি সমস্যা করে
    const snap = await getDocs(collection(db, "products"));
    PRODUCTS = [];
    snap.forEach(d => {
      const data = d.data();
      if (data.active !== false) PRODUCTS.push({ id: d.id, ...data });
    });
  }
  renderGrid();
}

function money(n){
  return "৳" + Number(n || 0).toLocaleString("en-IN");
}

function renderGrid(){
  if (!PRODUCTS.length){
    grid.innerHTML = "";
    emptyState.style.display = "block";
    return;
  }
  emptyState.style.display = "none";
  grid.innerHTML = PRODUCTS.map(p => {
    const img = (p.images && p.images[0]) ? `<img src="${p.images[0]}" alt="">` : `<span class="ph">ছবি নেই</span>`;
    const hasDiscount = p.oldPrice && Number(p.oldPrice) > Number(p.price);
    const off = hasDiscount ? Math.round(100 - (p.price / p.oldPrice) * 100) : null;
    const outOfStock = (p.stock !== null && p.stock !== undefined && Number(p.stock) <= 0);
    return `
      <div class="card" data-id="${p.id}">
        <div class="thumb">${img}</div>
        <div class="info">
          <div class="name">${escapeHtml(p.name || "নাম নেই")}</div>
          <div class="price-row">
            <span class="price-now">${money(p.price)}</span>
            ${hasDiscount ? `<span class="price-old">${money(p.oldPrice)}</span>` : ""}
          </div>
          ${off ? `<span class="badge-off">${off}% ছাড়</span>` : ""}
          ${outOfStock ? `<span class="stock-out">স্টক শেষ</span>` : ""}
        </div>
      </div>`;
  }).join("");

  grid.querySelectorAll(".card").forEach(card => {
    card.addEventListener("click", () => openProduct(card.dataset.id));
  });
}

function escapeHtml(str){
  const d = document.createElement("div");
  d.textContent = str;
  return d.innerHTML;
}

// ---------- product detail ----------
function openProduct(id){
  currentProduct = PRODUCTS.find(p => p.id === id);
  if (!currentProduct) return;
  currentImgIndex = 0;
  renderProductSheet();
  $("#productOverlay").classList.add("open");
}

function renderProductSheet(){
  const p = currentProduct;
  const images = (p.images && p.images.length) ? p.images : [];
  const hasDiscount = p.oldPrice && Number(p.oldPrice) > Number(p.price);
  const inCart = CART[p.id]?.qty || 0;
  const stockLimited = (p.stock !== null && p.stock !== undefined);
  const outOfStock = stockLimited && Number(p.stock) <= 0;

  $("#pdSheetBody").innerHTML = `
    <div class="pd-gallery">${images.length ? `<img id="pdMainImg" src="${images[currentImgIndex]}">` : `<span class="ph">ছবি নেই</span>`}</div>
    ${images.length > 1 ? `<div class="pd-thumbs">${images.map((im,i)=>`<img src="${im}" class="${i===currentImgIndex?'active':''}" data-i="${i}">`).join("")}</div>` : ""}
    <h2 class="pd-name">${escapeHtml(p.name || "")}</h2>
    <div class="pd-price-row">
      <span class="pd-price-now">${money(p.price)}</span>
      ${hasDiscount ? `<span class="pd-price-old">${money(p.oldPrice)}</span>` : ""}
    </div>
    ${p.description ? `<p class="pd-desc">${escapeHtml(p.description)}</p>` : ""}
    ${outOfStock ? `<p class="stock-out" style="margin-bottom:16px;">এই মুহূর্তে স্টকে নেই</p>` : `
    <div class="qty-row">
      <div class="qty-box">
        <button id="pdMinus" type="button">−</button>
        <span class="n" id="pdQty">1</span>
        <button id="pdPlus" type="button">+</button>
      </div>
      ${stockLimited ? `<span class="opt" style="font-size:13px;color:var(--muted)">স্টকে আছে ${p.stock}টি</span>` : ""}
    </div>
    <button class="btn-primary" id="pdAddBtn">কার্টে যোগ করুন${inCart ? ` (কার্টে আছে ${inCart}টি)` : ""}</button>
    `}
  `;

  let qty = 1;
  const qtyEl = () => $("#pdQty");
  const maxQty = stockLimited ? Number(p.stock) : Infinity;

  $("#pdSheetBody").querySelectorAll(".pd-thumbs img").forEach(t => {
    t.addEventListener("click", () => { currentImgIndex = Number(t.dataset.i); renderProductSheet(); });
  });

  if (!outOfStock){
    $("#pdMinus").addEventListener("click", () => {
      qty = Math.max(1, qty - 1);
      qtyEl().textContent = qty;
    });
    $("#pdPlus").addEventListener("click", () => {
      qty = Math.min(maxQty, qty + 1);
      qtyEl().textContent = qty;
    });
    $("#pdAddBtn").addEventListener("click", () => {
      addToCart(p, qty);
      closeProductSheet();
      showToast("কার্টে যোগ করা হয়েছে");
    });
  }
}

function closeProductSheet(){
  $("#productOverlay").classList.remove("open");
}

// ---------- cart ----------
function addToCart(product, qty){
  if (CART[product.id]) {
    CART[product.id].qty += qty;
  } else {
    CART[product.id] = { product, qty };
  }
  updateCartButton();
}

function updateCartButton(){
  const count = Object.values(CART).reduce((s, c) => s + c.qty, 0);
  $("#cartCount").textContent = count;
  $("#cartBtn").style.display = count > 0 ? "flex" : "none";
}

function cartTotal(){
  return Object.values(CART).reduce((s, c) => s + c.qty * Number(c.product.price || 0), 0);
}

function renderCart(){
  const lines = Object.entries(CART);
  const body = $("#cartSheetBody");
  if (!lines.length){
    body.innerHTML = `<div class="cart-empty">কার্ট খালি</div>`;
    return;
  }
  body.innerHTML = lines.map(([id, c]) => {
    const img = (c.product.images && c.product.images[0]) ? c.product.images[0] : "";
    return `
    <div class="cart-line" data-id="${id}">
      ${img ? `<img src="${img}">` : `<div style="width:60px;height:60px;background:#efeae0"></div>`}
      <div class="meta">
        <div class="name">${escapeHtml(c.product.name)}</div>
        <div class="row2">
          <div class="qty-box">
            <button type="button" class="c-minus">−</button>
            <span class="n">${c.qty}</span>
            <button type="button" class="c-plus">+</button>
          </div>
          <strong>${money(c.qty * c.product.price)}</strong>
        </div>
        <button class="rm" type="button">সরিয়ে দিন</button>
      </div>
    </div>`;
  }).join("") + `<div class="cart-total-row"><span>মোট</span><span>${money(cartTotal())}</span></div>`;

  body.querySelectorAll(".cart-line").forEach(line => {
    const id = line.dataset.id;
    const c = CART[id];
    const stockLimited = (c.product.stock !== null && c.product.stock !== undefined);
    line.querySelector(".c-plus").addEventListener("click", () => {
      if (stockLimited && c.qty >= Number(c.product.stock)) return;
      c.qty++; renderCart(); updateCartButton();
    });
    line.querySelector(".c-minus").addEventListener("click", () => {
      c.qty--;
      if (c.qty <= 0) delete CART[id];
      renderCart(); updateCartButton();
    });
    line.querySelector(".rm").addEventListener("click", () => {
      delete CART[id]; renderCart(); updateCartButton();
    });
  });

  $("#goCheckoutBtn").style.display = lines.length ? "block" : "none";
}

function showToast(msg){
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2200);
}

// ---------- checkout ----------
async function submitOrder(e){
  e.preventDefault();
  const name = $("#coName").value.trim();
  const phone = $("#coPhone").value.trim();
  const address = $("#coAddress").value.trim();
  const note = $("#coNote").value.trim();
  if (!name || !phone || !address){
    showToast("নাম, ফোন ও ঠিকানা দিন");
    return;
  }
  const items = Object.values(CART).map(c => ({
    productId: c.product.id,
    name: c.product.name,
    price: Number(c.product.price || 0),
    qty: c.qty,
    imageUrl: (c.product.images && c.product.images[0]) || null
  }));
  if (!items.length) return;

  const btn = $("#submitOrderBtn");
  btn.disabled = true; btn.textContent = "অর্ডার হচ্ছে...";

  try{
    await addDoc(collection(db, "orders"), {
      items,
      total: cartTotal(),
      customer: { name, phone, address, note },
      status: "pending",
      createdAt: serverTimestamp()
    });
    CART = {};
    updateCartButton();
    $("#checkoutOverlay").classList.remove("open");
    $("#cartOverlay").classList.remove("open");
    $("#orderForm").reset();
    showOrderSuccess();
  }catch(err){
    console.error(err);
    showToast("অর্ডার করতে সমস্যা হয়েছে, আবার চেষ্টা করুন");
  }finally{
    btn.disabled = false; btn.textContent = "অর্ডার সাবমিট করুন";
  }
}

function showOrderSuccess(){
  $("#successOverlay").classList.add("open");
}

// ---------- wire up static UI ----------
function init(){
  document.getElementById("closeProductSheet").addEventListener("click", closeProductSheet);
  document.getElementById("productOverlay").addEventListener("click", (e) => { if (e.target.id === "productOverlay") closeProductSheet(); });

  document.getElementById("cartBtn").addEventListener("click", () => {
    renderCart();
    document.getElementById("cartOverlay").classList.add("open");
  });
  document.getElementById("closeCartSheet").addEventListener("click", () => document.getElementById("cartOverlay").classList.remove("open"));
  document.getElementById("cartOverlay").addEventListener("click", (e) => { if (e.target.id === "cartOverlay") document.getElementById("cartOverlay").classList.remove("open"); });

  document.getElementById("goCheckoutBtn").addEventListener("click", () => {
    document.getElementById("cartOverlay").classList.remove("open");
    document.getElementById("checkoutOverlay").classList.add("open");
    document.getElementById("checkoutTotal").textContent = money(cartTotal());
  });
  document.getElementById("closeCheckoutSheet").addEventListener("click", () => document.getElementById("checkoutOverlay").classList.remove("open"));
  document.getElementById("checkoutOverlay").addEventListener("click", (e) => { if (e.target.id === "checkoutOverlay") document.getElementById("checkoutOverlay").classList.remove("open"); });

  document.getElementById("orderForm").addEventListener("submit", submitOrder);

  document.getElementById("closeSuccess").addEventListener("click", () => document.getElementById("successOverlay").classList.remove("open"));
  document.getElementById("successOverlay").addEventListener("click", (e) => { if (e.target.id === "successOverlay") document.getElementById("successOverlay").classList.remove("open"); });

  updateCartButton();
  loadProducts();
}

document.addEventListener("DOMContentLoaded", init);
