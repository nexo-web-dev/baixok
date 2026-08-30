import json
import sys

from playwright.sync_api import sync_playwright


def main():
    console_errors = []
    page_errors = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 390, "height": 844})
        page.on(
            "console",
            lambda message: console_errors.append(message.text)
            if message.type == "error"
            else None,
        )
        page.on("pageerror", lambda error: page_errors.append(str(error)))

        response = page.goto(
            "http://127.0.0.1:3005/",
            wait_until="networkidle",
            timeout=30000,
        )

        result = {
            "status": response.status if response else None,
            "title": page.title(),
            "email_input": page.locator("#login-email").count(),
            "password_input": page.locator("#login-senha").count(),
            "submit_button": page.locator("#form-login button[type='submit']").count(),
            "horizontal_overflow": page.evaluate(
                "document.documentElement.scrollWidth > document.documentElement.clientWidth"
            ),
            "console_errors": console_errors,
            "page_errors": page_errors,
        }
        print(json.dumps(result, ensure_ascii=False))
        browser.close()

    if (
        result["status"] != 200
        or not result["email_input"]
        or not result["password_input"]
        or not result["submit_button"]
        or result["horizontal_overflow"]
        or result["console_errors"]
        or result["page_errors"]
    ):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
