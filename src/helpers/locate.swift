import CoreLocation
import Foundation

class LocationHelper: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var done = false
    private let outputPath: String

    init(outputPath: String) {
        self.outputPath = outputPath
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
    }

    func run() {
        manager.requestWhenInUseAuthorization()
        manager.startUpdatingLocation()
        // Run for up to 10 seconds
        let deadline = Date().addingTimeInterval(10)
        while !done && Date() < deadline {
            RunLoop.current.run(until: Date().addingTimeInterval(0.1))
        }
        if !done {
            writeResult("{\"error\":\"timeout\"}")
        }
        exit(0)
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { return }
        if loc.horizontalAccuracy < 0 { return }
        done = true
        manager.stopUpdatingLocation()
        let json = "{\"latitude\":\(loc.coordinate.latitude),\"longitude\":\(loc.coordinate.longitude),\"accuracy\":\(loc.horizontalAccuracy)}"
        writeResult(json)
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        done = true
        manager.stopUpdatingLocation()
        writeResult("{\"error\":\"\(error.localizedDescription)\"}")
    }

    private func writeResult(_ json: String) {
        try? json.write(toFile: outputPath, atomically: true, encoding: .utf8)
    }
}

// Output path passed as first argument, or use temp default
let outputPath = CommandLine.arguments.count > 1
    ? CommandLine.arguments[1]
    : NSTemporaryDirectory() + "worldcam-location.json"

let helper = LocationHelper(outputPath: outputPath)
helper.run()
