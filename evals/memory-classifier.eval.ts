/**
 * Braintrust offline eval for the memory note classifier.
 *
 * Run: pnpm eval:memory-classifier
 * Needs: OPENAI_API_KEY, BRAINTRUST_API_KEY (or .braintrust.json from wizard)
 *
 * Tests the ONE dedicated LLM call in the memory system: classifying free-text
 * feedback notes into structured memory drafts. The headline trap is variety vs
 * dislike ("not pizza every week" must NOT become a ban).
 */
import './load-dev-vars'
import { Eval } from 'braintrust'
import { memoryClassifierDataset } from '../src/lib/memory/eval/dataset'
import { runMemoryClassifierEvalTask } from '../src/lib/memory/eval/run-task'
import { memoryClassifierScorers } from '../src/lib/memory/eval/scorers'

Eval('Smart Cart', {
  experimentName: 'memory-classifier',
  description:
    'Feedback-note classifier: variety vs dislike trap, allergies, preferences, Dutch phrasing, scope.',
  data: memoryClassifierDataset(),
  task: runMemoryClassifierEvalTask,
  scores: memoryClassifierScorers,
  metadata: {
    agent: 'memory-classifier',
    model: 'gpt-5-mini',
  },
})
