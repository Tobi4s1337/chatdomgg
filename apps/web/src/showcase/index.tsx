// The showcase moved into the story at the front page. The public gateway answers /showcase with a permanent
// redirect; this keeps the same promise for development servers, which serve the app for every path.
export default function Showcase() {
  location.replace('/');
  return null;
}
