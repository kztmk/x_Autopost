import { VERSION } from "../constants";

export function getVersion() {
  return {
    status: "success",
    data: {
      version: VERSION,
    },
    message: "x_Autopost version retrieved.",
    code: 200,
  };
}
