import XCTest

/// Runs the real SwiftUI hierarchy with isolated, in-memory host data. No host or account is used.
@MainActor final class FocusJourneyTests: XCTestCase {
    private let app = XCUIApplication()
    private let laptop = "11111111-1111-4111-8111-111111111111"

    override func setUpWithError() throws {
        continueAfterFailure = false
        XCUIDevice.shared.orientation = .portrait
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
    private func reveal(_ element: XCUIElement, swipingDown: Bool = false) {
        for _ in 0..<8 {
            if element.exists && element.isHittable { return }
            if swipingDown { app.swipeDown() } else { app.swipeUp() }
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
        reveal(row("iphone"))
        reveal(row("wiring"))
        XCTAssertTrue(app.textFields["thread-search"].isHittable, "Search stays above the scrolling thread list")
        XCTAssertTrue(row("wiring").label.contains("Working"), "Background work must not read Done")
        reveal(app.textFields["thread-search"], swipingDown: true)
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
        XCTAssertTrue(search.isHittable, "Search remains visible at the bottom of the list")
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
        reveal(app.buttons["Not now"])
        app.buttons["Not now"].tap()
        let permission = "Allow reading the release checklist?"
        XCTAssertTrue(app.staticTexts[permission].waitForExistence(timeout: 5), "Deferring the first request exposes the second")
        capture("thread-second-request")
        reveal(app.buttons["Not now"])
        app.buttons["Not now"].tap()
        let requests = app.buttons["thread-requests"]
        XCTAssertTrue(requests.waitForExistence(timeout: 5))
        requests.tap()
        app.buttons["Which release should I prepare?"].tap()
        XCTAssertTrue(app.staticTexts["Which release should I prepare?"].waitForExistence(timeout: 5))
        reveal(app.buttons["Not now"])
        app.buttons["Not now"].tap()
        XCTAssertTrue(requests.waitForExistence(timeout: 5))
        requests.tap()
        app.buttons[permission].tap()
        XCTAssertTrue(app.staticTexts[permission].waitForExistence(timeout: 5), "Both unanswered requests remain reachable from the composer")
        reveal(app.buttons["Not now"])
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
        reveal(app.buttons["setting-dark"], swipingDown: true)
        app.buttons["setting-dark"].tap()
        XCTAssertEqual(app.buttons["setting-dark"].value as? String, "Selected")
        app.tabBars.buttons["Threads"].tap()
        capture("focus-dark-larger-text")
    }

    func testComputerScopePreservesSearchAndLandscape() {
        let filter = app.buttons["computer-filter"]
        let search = app.textFields["thread-search"]
        let lighting = app.buttons["thread-22222222-2222-4222-8222-222222222222/lighting"]
        filter.tap()
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Laptop")).firstMatch.tap()
        XCTAssertEqual(filter.value as? String, "Laptop")
        XCTAssertTrue(row("release").exists)
        XCTAssertFalse(lighting.exists)

        filter.tap()
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Studio Mac")).firstMatch.tap()
        XCTAssertEqual(filter.value as? String, "Studio Mac")
        reveal(lighting)
        XCTAssertFalse(row("release").exists)
        capture("offline-computer-scope")
        reveal(search, swipingDown: true)
        search.tap()
        search.typeText("lighting\n")
        filter.tap()
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Laptop")).firstMatch.tap()
        XCTAssertEqual(search.value as? String, "lighting")
        XCTAssertTrue(app.staticTexts["No matching threads."].exists)
        filter.tap()
        app.buttons["All computers"].tap()
        reveal(lighting)
        XCTAssertEqual(search.value as? String, "lighting")
        reveal(search, swipingDown: true)
        app.buttons["Clear search"].tap()
        search.typeText("\n")

        XCUIDevice.shared.orientation = .landscapeLeft
        let landscape = NSPredicate { _, _ in
            let frame = self.app.windows.firstMatch.frame
            return frame.width > frame.height
        }
        expectation(for: landscape, evaluatedWith: app.windows.firstMatch)
        waitForExpectations(timeout: 5)
        capture("focus-landscape")
        XCTAssertTrue(app.tabBars.buttons["Settings"].isHittable)
        XCUIDevice.shared.orientation = .portrait
    }
}
