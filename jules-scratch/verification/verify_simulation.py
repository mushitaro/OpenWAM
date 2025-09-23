import time
from playwright.sync_api import sync_playwright, Page, expect

def run_verification(page: Page):
    """
    Navigates to the app, runs a simulation, and takes a screenshot.
    """
    # Navigate to the local server
    page.goto("http://localhost:8000")

    # Wait for the WASM module to be ready by checking if the button is enabled.
    # Give it a long timeout because WASM can be slow to initialize.
    run_button = page.get_by_role("button", name="Run Simulation")

    print("Waiting for the simulation engine to load...")
    expect(run_button).to_be_enabled(timeout=30000) # 30 second timeout
    print("Engine loaded. Clicking 'Run Simulation'.")

    # Click the button to run the simulation
    run_button.click()

    # Wait for the chart to be rendered by looking for the canvas element.
    # The chart component only renders the canvas after it receives data.
    chart_canvas = page.locator("canvas")

    print("Waiting for the simulation chart to render...")
    expect(chart_canvas).to_be_visible(timeout=15000) # 15 second timeout
    print("Chart rendered.")

    # Give a brief moment for chart animation to settle
    time.sleep(1)

    # Take a screenshot for visual confirmation
    screenshot_path = "/app/jules-scratch/verification/simulation.png"
    page.screenshot(path=screenshot_path)
    print(f"Screenshot saved to {screenshot_path}")


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            run_verification(page)
        except Exception as e:
            print(f"An error occurred during verification: {e}")
            # Try to take a screenshot even on failure for debugging
            page.screenshot(path="/app/jules-scratch/verification/error.png")
            raise
        finally:
            browser.close()

if __name__ == "__main__":
    main()
