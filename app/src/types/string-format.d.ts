declare module "string-format" {
  function format(template: string, values: Record<string, string>): string;
  export default format;
}
