import { Bunify } from "./src/core";

const app = new Bunify();

app.get("/hello", (req, res) => {
  return { message: "Hello, World!" };
});

app.listen(3000, (address) => {
  console.log(`Server is running at http://${address}`);
});
