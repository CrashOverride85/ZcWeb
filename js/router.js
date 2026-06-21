export function createRouter({ root, routes, defaultRoute, linkSelector }) {
  function currentHashRoute() {
    return window.location.hash.replace(/^#/, "");
  }

  function updateActiveLinks(route) {
    document.querySelectorAll(linkSelector).forEach((link) => {
      link.classList.toggle("is-active", link.dataset.routeLink === route);
    });
  }

  async function render() {
    const hashRoute = currentHashRoute();
    const route = routes[hashRoute] ? hashRoute : defaultRoute;

    if (hashRoute !== route) {
      window.location.hash = `#${route}`;
      return;
    }

    root.replaceChildren();
    updateActiveLinks(route);
    await routes[route](root);
    root.focus({ preventScroll: true });
  }

  return {
    start() {
      window.addEventListener("hashchange", render);
      render();
    },
  };
}
