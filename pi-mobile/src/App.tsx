import { Router, Route } from "@solidjs/router";
import Sessions from "@/features/sessions/Sessions";
import Session from "@/features/chat/Session";
import Settings from "@/features/settings/Settings";
import Onboarding from "@/features/onboarding/Onboarding";

export default function App() {
  return (
    <Router>
      <Route path="/" component={Sessions} />
      <Route path="/s/:id" component={Session} />
      <Route path="/settings" component={Settings} />
      <Route path="/onboarding" component={Onboarding} />
    </Router>
  );
}
