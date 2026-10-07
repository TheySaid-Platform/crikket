// Small DOM helpers for the floating bar, which is plain DOM (no React) so it
// can run inside any web page.

export function createButton(
  label: string,
  onClick: () => void
): HTMLButtonElement {
  const button = document.createElement("button")
  button.type = "button"
  button.className = "button"
  setLabel(button, label)
  button.addEventListener("click", (event) => {
    event.stopPropagation()
    onClick()
  })
  return button
}

// A styled tooltip instead of the browser's, which looks out of place here.
export function setLabel(element: HTMLElement, label: string): void {
  element.dataset.tip = label
  element.setAttribute("aria-label", label)
}

export function createDivider(): HTMLElement {
  const divider = document.createElement("span")
  divider.className = "divider"
  return divider
}
