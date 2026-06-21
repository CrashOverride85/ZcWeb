export function renderAboutPage(root) {
  root.innerHTML = `
    <section class="page-heading">
      <div>
        <h1>About</h1>
      </div>
    </section>
    <section class="about-empty" aria-label="About content"></section>
  `;
}
