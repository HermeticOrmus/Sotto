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
        waitForRenderedOrientation(landscape: false)
    }

    private func row(_ id: String) -> XCUIElement { app.buttons["thread-\(laptop)/\(id)"] }
    private func capture(_ name: String) {
        // Capture the screen rather than the app's rotating/clipped window crop.
        let attachment = XCTAttachment(screenshot: XCUIScreen.main.screenshot())
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }
    private func reveal(_ element: XCUIElement, swipingDown: Bool = false) {
        var down = swipingDown
        var steps: [String] = []
        for attempt in 0..<40 {
            if element.exists && element.isHittable { return }
            // A full-window fling can skip a whole card. Keep each drag inside the foreground
            // scroll view, clear of the pinned search/header and the floating system tab bar.
            guard let scroll = app.scrollViews.allElementsBoundByIndex.last(where: { $0.isHittable }) else {
                steps.append("No hittable scroll view on attempt \(attempt)")
                break
            }
            let window = app.windows.firstMatch
            var visible = scroll.frame.intersection(window.frame)
            let tab = app.tabBars.firstMatch
            if tab.exists && tab.isHittable && tab.frame.minY > visible.minY {
                visible.size.height = min(visible.maxY, tab.frame.minY) - visible.minY
            }
            guard !visible.isNull, visible.width > 20, visible.height > 40 else {
                steps.append("No usable scroll viewport: \(visible)")
                break
            }
            if element.exists {
                let target = element.frame
                if !target.isEmpty {
                    if target.maxY <= visible.minY + 12 { down = true }
                    else if target.minY >= visible.maxY - 12 { down = false }
                }
                steps.append("\(attempt): target \(target), viewport \(visible), down \(down)")
            } else {
                steps.append("\(attempt): target not materialized, viewport \(visible), down \(down)")
            }
            let distance = min(120, visible.height * 0.3)
            let direction: CGFloat = down ? 1 : -1
            let origin = window.coordinate(withNormalizedOffset: .zero)
            let x = visible.midX - window.frame.minX
            let y = visible.midY - window.frame.minY
            let start = origin.withOffset(CGVector(dx: x, dy: y - direction * distance / 2))
            let end = origin.withOffset(CGVector(dx: x, dy: y + direction * distance / 2))
            start.press(forDuration: 0.05, thenDragTo: end, withVelocity: .slow, thenHoldForDuration: 0.15)
        }
        if element.exists && element.isHittable { return }
        capture("unreachable-control")
        let diagnostic = XCTAttachment(string: steps.joined(separator: "\n") + "\n\n" + app.debugDescription)
        diagnostic.name = "Scroll reachability and accessibility hierarchy"
        diagnostic.lifetime = .keepAlways
        add(diagnostic)
        XCTAssertTrue(element.isHittable, "The control must remain reachable by scrolling")
    }
    private func waitForRenderedOrientation(landscape: Bool) {
        var consecutiveMatches = 0
        var samples: [String] = []
        let rendered = NSPredicate { _, _ in
            let frame = self.app.windows.firstMatch.frame
            let image = XCUIScreen.main.screenshot().image
            var imageSize = image.cgImage.map { CGSize(width: CGFloat($0.width), height: CGFloat($0.height)) } ?? image.size
            // A screenshot may store portrait pixels with a quarter-turn orientation. Read the
            // displayed dimensions, rather than interpreting raw PNG dimensions as orientation.
            switch image.imageOrientation {
            case .left, .right, .leftMirrored, .rightMirrored:
                imageSize = CGSize(width: imageSize.height, height: imageSize.width)
            default: break
            }
            samples.append("window \(frame), displayed screen \(imageSize), orientation \(image.imageOrientation.rawValue)")
            let matches = (frame.width > frame.height) == landscape
                && (imageSize.width > imageSize.height) == landscape
            consecutiveMatches = matches ? consecutiveMatches + 1 : 0
            return consecutiveMatches >= 2
        }
        // Window geometry and screenshot orientation can settle separately during rotation.
        let ready = XCTNSPredicateExpectation(predicate: rendered, object: app)
        let result = XCTWaiter.wait(for: [ready], timeout: 10)
        if result != .completed {
            capture("rotation-not-ready")
            let diagnostic = XCTAttachment(string: samples.joined(separator: "\n"))
            diagnostic.name = "Window and screen orientation samples"
            diagnostic.lifetime = .keepAlways
            add(diagnostic)
        }
        XCTAssertEqual(result, .completed,
                       "The rendered screenshot must finish rotating with the window")
    }
    private func back() { app.navigationBars.buttons.element(boundBy: 0).tap() }

    func testFocusSearchAndNavigation() {
        XCTAssertTrue(app.tabBars.buttons["Threads"].isSelected)
        XCTAssertFalse(app.tabBars.buttons["Needs you"].exists)
        XCTAssertTrue(app.tabBars.buttons["Computers"].exists)
        XCTAssertTrue(app.tabBars.buttons["Settings"].exists)
        XCTAssertTrue(row("release").exists)
        capture("focus-dark")
        reveal(row("iphone"))
        reveal(row("wiring"))
        XCTAssertTrue(app.textFields["thread-search"].isHittable, "Search stays above the scrolling thread list")
        XCTAssertTrue(row("wiring").label.contains("Working"), "Background work must not read Done")
        capture("working-threads")
        reveal(app.textFields["thread-search"], swipingDown: true)

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
        reveal(settled, swipingDown: true)
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

    func testRecoveryAndNeutralDeliveryFeedbackInBothAppearances() {
        let scenarios = [
            ("request-gone", "That request is no longer waiting."),
            ("markers-unreadable", "Saved unconfirmed actions could not be read. Check your threads before sending again. Nothing was resent."),
            ("computer-unreadable", "Recovered the saved computer list. Pair computer 22222222-2222-4222-8222-222222222222 again. Its saved connection details could not be read.")
        ]
        for (scenario, words) in scenarios {
            app.terminate()
            app.launchArguments = ["--ui-fixture", "--reset-ui-preferences", "--ui-feedback-" + scenario]
            app.launch()
            let message = app.staticTexts.matching(NSPredicate(format: "label == %@", words)).firstMatch
            XCTAssertTrue(message.waitForExistence(timeout: 15))
            reveal(message)
            XCTAssertFalse(app.staticTexts["Answer sent."].exists)
            capture("feedback-" + scenario + "-dark")
            app.tabBars.buttons["Settings"].tap()
            XCTAssertTrue(app.buttons["setting-light"].waitForExistence(timeout: 5))
            app.buttons["setting-light"].tap()
            let larger = app.switches["setting-larger-text"]
            reveal(larger)
            larger.tap()
            app.tabBars.buttons["Threads"].tap()
            reveal(message, swipingDown: true)
            capture("feedback-" + scenario + "-light-larger-text")
            let dismiss = app.buttons["Dismiss message"]
            reveal(dismiss, swipingDown: true)
            dismiss.tap()
            XCTAssertFalse(message.exists)
        }
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
        capture("focus-connected")

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
        waitForRenderedOrientation(landscape: true)
        capture("focus-landscape")
        XCTAssertTrue(app.tabBars.buttons["Settings"].isHittable)
        XCUIDevice.shared.orientation = .portrait
        waitForRenderedOrientation(landscape: false)
    }
}
