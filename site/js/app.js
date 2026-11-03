// Entry point for every public page: draws the layout, then runs the page by <body data-page>.
import { chrome } from './layout.js';
import * as C from './pages/catalog.js';
import * as A from './pages/account.js';
const PAGES = {
  home: C.home, products: () => C.listing('products'), trending: () => C.listing('trending'), deals: () => C.listing('deals'), featured: () => C.listing('featured'),
  product: C.product, categories: C.categoriesPage, brands: C.brandsPage, apps: () => C.appsPage(false), apk: () => C.appsPage(true), app: C.appDetail,
  videos: () => C.videosPage('tutorial'), 'promo-videos': () => C.videosPage('promo'), ads: C.adsPage, offers: C.offersPage, about: C.aboutPage, contact: C.contactPage,
  login: A.login, register: A.register, forgot: A.forgot, reset: A.reset, dashboard: A.dashboard, profile: A.profilePage, wishlist: A.wishlistPage, cart: A.cartPage, checkout: A.checkout,
  payment: A.payment, 'payment-submit': A.paymentSubmit, orders: A.orders, order: A.orderDetail, wallet: A.walletPage, returns: A.returnsPage,
};
(async () => {
  const page = document.body.dataset.page;
  try { await chrome(); } catch (e) { console.error(e); }
  try { if (page && page.startsWith('legal-')) await C.legalPage(page.slice(6)); else if (PAGES[page]) await PAGES[page](); }
  catch (e) { if (e && e.message === 'redirect') return; console.error(e); const m = document.getElementById('main'); if (m && !m.dataset.static) m.insertAdjacentHTML('afterbegin', '<div class="container"><div class="alert bad" style="margin-top:16px">Something went wrong loading this page. Please refresh. If it keeps happening, contact us on WhatsApp.</div></div>'); }
})();
