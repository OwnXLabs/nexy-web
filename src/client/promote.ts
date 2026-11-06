// When Nexy offers to make a conversation a Project: the work has several steps (two things made
// in the chat), or something made is meant to go out to the world.
export const PUBLISHES = /\b(publish|put (?:it|this) online|go live|make (?:it|this) public|share (?:it|this) (?:publicly|online)|deploy|launch (?:it|this)|(?:my|a) (?:own )?(?:domain|url|web address))\b/i;

export function offersProject(made: number, said: string): boolean {
  return made >= 2 || (made >= 1 && PUBLISHES.test(said));
}
