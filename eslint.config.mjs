import config from "@adddog/eslint";

export default config().overrideRules({
    "no-console": "off",
    "node/prefer-global/process": "off",
    "node/prefer-global/buffer": "off",
});
