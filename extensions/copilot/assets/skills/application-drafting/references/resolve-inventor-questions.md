# Resolve Inventor Questions

The save writes each Inventor Question to `inventor-answers.md` with an empty
`**Answer:**` slot. The attorney or the inventor fills it. When the attorney
asks you to apply the answers:

1. Read `inventor-answers.md`. Use only the current answer of each question
   (the last `**Answer:**` of its section). An empty answer, "Not stated" or
   "unknown" is no answer.
2. Write each answer at the place its question names, in the inventor's
   words, with the marker `<!-- src: inventor:IQ-n -->`. Add no fact the
   answer does not state.
3. Delete the answered question. When the answer is partial, keep the
   question, with its number, and narrow it to the part that is still open:
   the save then adds the narrowed question to `inventor-answers.md` with a
   new empty slot.
4. Save the draft and call `validate_draft` again.

A question you delete while its current answer is empty stays an Error until
the attorney waives it. Never edit `inventor-answers.md` yourself: the save
writes the questions, and only the attorney or the inventor writes answers.
