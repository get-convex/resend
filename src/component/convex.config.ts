import { defineComponent } from "convex/server";
import rateLimiter from "@convex-dev/rate-limiter/convex.config";
import workpool from "@convex-dev/workpool/convex.config";

const component = defineComponent("resend");
component.use(rateLimiter);
component.use(workpool, { name: "emailWorkpool" });
component.use(workpool, { name: "callbackWorkpool" });

export default component;
