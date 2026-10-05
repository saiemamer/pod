import type {
  AeSetupDetection,
  AeSetupQuestion,
  AeSetupRunRequest,
  AeSetupRunResult
} from '../../../shared/ae/setup-types'
import { detectAeSetup, summarizeAeSetup, type AeSetupProbeDeps } from './ae-setup-detect'
import { applyAeSetup, type AeSetupApplyDeps } from './ae-setup-apply'

/**
 * Pod: first setup as one call. Detect, and when nothing needs the person, apply at once;
 * otherwise return the questions and change nothing.
 */
export async function runAeSetup(
  request: AeSetupRunRequest,
  deps: { probe: AeSetupProbeDeps; apply: AeSetupApplyDeps }
): Promise<AeSetupRunResult> {
  const detection = withPickedTarget(await detectAeSetup(request, deps.probe), request.target)
  const questions = setupQuestions(detection, request)
  if (questions.length > 0) {
    return { detection, questions, applied: null }
  }
  const applied = await applyAeSetup({ detection }, deps.apply)
  return { detection, questions, applied }
}

/** The person's pick becomes the chosen target, so the summary shows what was set up. */
function withPickedTarget(
  detection: AeSetupDetection,
  picked: string | undefined
): AeSetupDetection {
  const target = picked?.trim()
  if (!target || detection.target || !detection.profiles.targets.includes(target)) {
    return detection
  }
  const next = { ...detection, target }
  return { ...next, items: summarizeAeSetup(next) }
}

/** Pod asks only where it cannot choose safely: several projects, a production-looking default, no dbt that runs. */
function setupQuestions(
  detection: AeSetupDetection,
  request: AeSetupRunRequest
): AeSetupQuestion[] {
  const questions: AeSetupQuestion[] = []
  if (!detection.project && detection.projectDirs.length > 1) {
    questions.push({
      kind: 'project',
      options: detection.projectDirs,
      reason: `This repo holds ${detection.projectDirs.length} dbt projects. Which one should Pod use?`
    })
  }
  const { targets, defaultTarget } = detection.profiles
  if (!detection.target && targets.length > 0) {
    questions.push({
      kind: 'target',
      options: targets,
      reason: defaultTarget
        ? `Your profile's default target, "${defaultTarget}", looks like production. Which target should Pod run against?`
        : 'Your profile names no default target. Which target should Pod run against?'
    })
  }
  if (!detection.dbt.binary && !request.withoutDbt) {
    questions.push({
      kind: 'dbt',
      reason:
        detection.items.find((item) => item.key === 'dbt')?.hint ?? 'Pod found no dbt that runs.'
    })
  }
  return questions
}
