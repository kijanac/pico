import { AuthStorage } from "@earendil-works/pi-coding-agent";
import {
  fauxAssistantMessage,
  fauxText,
  registerFauxProvider,
} from "@earendil-works/pi-ai";

/**
 * Register pi-ai's faux provider with a small set of scripted responses
 * and return the model object suitable for `session.setModel(...)`.
 *
 * Used for shaking down the real pi pipeline end-to-end without API
 * keys. The faux provider's `setResponses` is called after registration
 * so each prompt() picks the next response in sequence.
 */
let fauxRegistration: ReturnType<typeof registerFauxProvider> | null = null;

const registerFaux = () => {
  if (!fauxRegistration) {
    fauxRegistration = registerFauxProvider({
      provider: "shakedown",
      // Unique api id so we don't collide with pi-ai's built-in providers.
      api: "faux",
      models: [
        {
          id: "shakedown-1",
          name: "Faux Shakedown",
          input: ["text"],
          contextWindow: 100_000,
          maxTokens: 4096,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        },
      ],
      // Slow it down a bit so we can observe streaming events.
      tokensPerSecond: 40,
      tokenSize: { min: 3, max: 7 },
    });
  }

  if (process.env.PI_FAUX_ERROR === "1") {
    fauxRegistration.setResponses([
      fauxAssistantMessage(fauxText(""), {
        stopReason: "error",
        errorMessage: "Connection error. (faux: simulated provider failure)",
      }),
    ]);
  } else {
    fauxRegistration.setResponses([
      fauxAssistantMessage(
        fauxText(
          "Acknowledged. Running a quick shakedown of the live pi event pipeline. " +
            "If you can read this in the chat, **streaming markdown** works.",
        ),
        { stopReason: "stop" },
      ),
    ]);
  }

  return fauxRegistration.getModel();
};

/**
 * If PI_FAUX=1 is set, register the deterministic faux provider and stash a
 * fake auth credential. Returns the faux model or null when not in faux mode.
 */
export const setupFauxIfEnabled = (
  authStorage: ReturnType<typeof AuthStorage.create>,
): ReturnType<typeof registerFaux> | null => {
  if (process.env.PI_FAUX !== "1") return null;
  const fauxModel = registerFaux();
  // The faux provider doesn't need real auth, but pi's model selection
  // enforces that AuthStorage has something for the provider.
  authStorage.setRuntimeApiKey("shakedown", "faux");
  return fauxModel;
};
