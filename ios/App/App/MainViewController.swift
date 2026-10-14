import UIKit
import Capacitor

/// Registers Lifedash's in-app native plugin with the Capacitor bridge.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(LifeNativePlugin())
    }
}
