"""Optional headless Chrome integration check against an already running local server.

Requires selenium (not needed to run the application). Outputs stay in .runtime/.
"""
from pathlib import Path
import json
import time

from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC


def main():
    folder = Path(__file__).resolve().parent.parent / ".runtime" / "browser"
    folder.mkdir(parents=True, exist_ok=True)
    options = webdriver.ChromeOptions()
    options.add_argument("--headless=new")
    options.add_argument("--window-size=1600,1200")
    options.add_argument("--no-proxy-server")
    options.set_capability("goog:loggingPrefs", {"browser": "ALL"})
    options.add_experimental_option("prefs", {"download.default_directory": str(folder), "download.prompt_for_download": False})
    driver = webdriver.Chrome(options=options)
    wait = WebDriverWait(driver, 45)

    def button(text):
        return driver.find_element(By.XPATH, f"//button[contains(normalize-space(.),'{text}')]")

    try:
        driver.get("http://127.0.0.1:8000")
        button("Explore synthetic demo").click()
        wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, "canvas")))
        wait.until(lambda d: "900" in d.find_element(By.CSS_SELECTOR, ".dataset-stats").text)
        button("Rectangle").click()
        canvas = driver.find_element(By.CSS_SELECTOR, "canvas")
        # Draw over roughly the left half of the fitted tissue view.
        width, height = canvas.size["width"], canvas.size["height"]
        ActionChains(driver).move_to_element_with_offset(canvas, -width/2+35, -height/2+35).click_and_hold().move_by_offset(width*.43, height-85).release().perform()
        wait.until(lambda d: not d.find_element(By.CSS_SELECTOR, ".selection-counter").text.startswith("0 "))
        selection = driver.find_element(By.CSS_SELECTOR, ".selection-counter").text
        driver.find_element(By.CSS_SELECTOR, ".group-a button").click()
        button("All cells except A").click()
        confirmation = driver.find_element(By.CSS_SELECTOR, ".run-card input[type=checkbox]")
        confirmation.click()
        run = button("Compare A")
        assert run.is_enabled(), "DE should be enabled for disjoint A / complement groups"
        run.click()
        wait.until(EC.presence_of_element_located((By.CSS_SELECTOR, "tbody tr")))
        row_count = len(driver.find_elements(By.CSS_SELECTOR, "tbody tr"))
        assert row_count == 24
        driver.find_element(By.CSS_SELECTOR, "tbody tr button").click()
        wait.until(lambda d: "EXPRESSION" in d.find_element(By.CSS_SELECTOR, ".sidebar").text)
        # Favorite two genes and verify both side-by-side maps render.
        search = driver.find_element(By.CSS_SELECTOR, "input[aria-label='Search genes']")
        search.send_keys(Keys.CONTROL, "a")
        search.send_keys(Keys.BACKSPACE)
        wait.until(lambda d: len(d.find_elements(By.CSS_SELECTOR, ".gene-list button")) > 2)
        for star in driver.find_elements(By.CSS_SELECTOR, ".gene-list button span")[:2]:
            star.click()
        button("favorite genes side by side").click()
        wait.until(lambda d: len(d.find_elements(By.CSS_SELECTOR, ".parallel-panel canvas")) == 2)
        button("Hide favorite").click()
        button("Save workspace").click()
        wait.until(lambda d: len(list(folder.glob("spatial-explorer-workspace*.json"))) > 0)
        workspace_file = max(folder.glob("spatial-explorer-workspace*.json"), key=lambda p:p.stat().st_mtime)
        saved = json.loads(workspace_file.read_text(encoding="utf-8"))
        assert saved["group_a"]["ids"] and saved["group_b"]["ids"]
        assert set(saved["group_a"]["ids"]).isdisjoint(saved["group_b"]["ids"])
        # Restore via the application's actual file input, without exposing a native dialog.
        driver.find_element(By.CSS_SELECTOR, "input[type=file]").send_keys(str(workspace_file))
        wait.until(lambda d: "Workspace restored" in d.find_element(By.CSS_SELECTOR, ".alert").text)
        assert not driver.find_element(By.CSS_SELECTOR, ".run-card input[type=checkbox]").is_selected()
        driver.execute_script("window.scrollTo(0,0)")
        driver.save_screenshot(str(folder / "explorer-desktop.png"))
        errors = [entry for entry in driver.get_log("browser") if entry["level"] == "SEVERE" and "favicon.ico" not in entry["message"]]
        assert not errors, errors
        driver.set_window_size(760, 1100)
        assert driver.execute_script("return document.documentElement.scrollWidth <= innerWidth"), "Unexpected horizontal overflow"
        driver.save_screenshot(str(folder / "explorer-narrow.png"))
        report = {"selection": selection, "de_rows": row_count, "workspace_restore": "passed", "parallel_gene_maps": "passed", "console_errors": errors, "responsive_overflow": "passed"}
        (folder / "report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
        print(json.dumps(report))
    finally:
        driver.quit()


if __name__ == "__main__":
    main()
