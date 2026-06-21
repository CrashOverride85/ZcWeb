import { createRouter } from "./router.js";
import { renderFirmwarePage } from "./pages/firmwarePage.js";
import { renderAboutPage } from "./pages/aboutPage.js";

const routes = {
  "/firmware": renderFirmwarePage,
  "/about": renderAboutPage,
};

createRouter({
  root: document.querySelector("#app"),
  routes,
  defaultRoute: "/firmware",
  linkSelector: "[data-route-link]",
}).start();
