// PLACEHOLDER: the "Dayparts" tab has no import rules yet, so this parser imports nothing.
// Returning undefined means no "dayparts" key is written to database.json, and an empty or missing tab is not an error.
// When the rules are decided: return the parsed data from parse() and delete "required: false" so an empty tab is caught.
export default {
  tab: "Dayparts",
  key: "dayparts",
  required: false,

  parse(filePath) {},
};
