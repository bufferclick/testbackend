(() => {
  const plugin = {
    onLoad: () => {
      const { commands } = window.vendetta || window.revenge;
      window.testCmd = commands.registerCommand({
        name: "testing",
        description: "Prints a greeting message",
        options: [],
        execute: () => ({ content: "hi bufferclick" })
      });
    },
    onUnload: () => {
      if (window.testCmd) window.testCmd();
    }
  };
  if (typeof module !== "undefined") module.exports = plugin;
  return plugin;
})();
