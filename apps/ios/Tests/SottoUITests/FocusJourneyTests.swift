import XCTest

/// Runs the real SwiftUI hierarchy with isolated, in-memory host data. No host or account is used.
@MainActor final class FocusJourneyTests: XCTestCase {
    private let app = XCUIApplication()
    private let laptop = "11111111-1111-4111-8111-111111111111"

    override func setUpWithError() throws {
        continueAfterFailure = false
        app.launchArguments = ["--ui-fixture", "--reset-ui-preferences"]
        app.launch()
        XCTAssertTrue(app.textFields["thread-search"].waitForExistence(timeout: 15))
    }

    private func row(_ id: String) -> XCUIElement { app.buttons["thread-\(laptop)/\(id)"] }
    private func capture(_ name: String) {
        let attachment = XCTAttachment(screenshot: app.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
    private func reveal(_ element: XCUIElement) {
        for _ in 0..<8 {
            if element.exists && element.isHittable { return }
            app.swipeUp()
        }
        XCTAssertTrue(element.isHittable, "The control must remain reachable by scrolling")
    }
    private func back() { app.navigationBars.buttons.element(boundBy: 0).tap() }

    func testFocusSearchAndNavigation() {
        XCTAssertTrue(app.tabBars.buttons["Threads"].isSelected)
        XCTAssertFalse(app.tabBars.buttons["Needs you"].exists)
        XCTAssertTrue(app.tabBars.buttons["Computers"].exists)
        XCTAssertTrue(app.tabBars.buttons["Settings"].exists)
        XCTAssertTrue(row("release").exists)
        XCTAssertTrue(row("iphone").exists)
        reveal(row("wiring"))
        XCTAssertTrue(row("wiring").label.contains("Working"), "Background work must not read Done")
        app.swipeDown()
        capture("focus-dark")

        let search = app.textFields["thread-search"]
        search.tap()
        search.typeText("Simplify")
        XCTAssertTrue(row("settings").waitForExistence(timeout: 5), "Search includes collapsed settled threads")
        XCTAssertFalse(row("iphone").exists)
        capture("search-settled-keyboard")
        search.typeText(String(repeating: XCUIKeyboardKey.delete.rawValue, count: 8))
        search.typeText("no matching thread")
        XCTAssertFalse(row("settings").exists)
        capture("search-empty")

        // Relaunch clears only transient search, allowing the real list's collapse state to be checked.
        app.terminate()
        app.launch()
        XCTAssertTrue(search.waitForExistence(timeout: 15))
        let settled = app.buttons["settled-threads"]
        reveal(settled)
        XCTAssertFalse(row("settings").exists)
        settled.tap()
        reveal(row("settings"))
        capture("settled-expanded")
        row("settings").tap()
        XCTAssertTrue(app.buttons["thread-pane-activity"].waitForExistence(timeout: 5))
        capture("thread-messages")
        app.buttons["thread-pane-activity"].tap()
        XCTAssertTrue(app.staticTexts["Read project notes"].waitForExistence(timeout: 5))
        capture("thread-activity")
        back()
        reveal(settled)
        settled.tap()
        XCTAssertFalse(row("settings").exists)

        app.terminate()
        app.launch()
        XCTAssertTrue(row("release").waitForExistence(timeout: 15))
        row("release").tap()
        XCTAssertTrue(app.buttons["Not now"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Which release should I prepare?"].exists)
        capture("thread-question")
        app.buttons["Not now"].tap()
        back()
        app.tabBars.buttons["Computers"].tap()
        XCTAssertTrue(app.staticTexts["Studio Mac"].waitForExistence(timeout: 5))
        capture("computers")
    }

    func testAppearanceAndLargerTextPersist() {
        app.tabBars.buttons["Settings"].tap()
        let light = app.buttons["setting-light"]
        XCTAssertTrue(light.waitForExistence(timeout: 5))
        light.tap()
        XCTAssertEqual(light.value as? String, "Selected")
        let larger = app.switches["setting-larger-text"]
        reveal(larger)
        larger.tap()
        XCTAssertEqual(larger.value as? String, "1")
        capture("settings-light-larger-text")

        app.terminate()
        app.launchArguments = ["--ui-fixture"]
        app.launch()
        XCTAssertTrue(app.textFields["thread-search"].waitForExistence(timeout: 15))
        capture("focus-light-larger-text")
        app.tabBars.buttons["Settings"].tap()
        XCTAssertTrue(light.waitForExistence(timeout: 5))
        XCTAssertEqual(light.value as? String, "Selected", "Appearance persists across launch")
        reveal(larger)
        XCTAssertEqual(larger.value as? String, "1", "Larger text persists across launch")
        app.buttons["setting-dark"].tap()
        XCTAssertEqual(app.buttons["setting-dark"].value as? String, "Selected")
        app.tabBars.buttons["Threads"].tap()
        capture("focus-dark-larger-text")
    }
}
