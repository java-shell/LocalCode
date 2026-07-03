@echo off
REM AI Rules Setup Automation
REM Usage: setup-ai-rules.bat [TargetPath]

setlocal

if "%~1"=="" (
    set "TARGET=%CD%"
) else (
    set "TARGET=%~1"
)

set "SOURCE=%~dp0"

echo.
echo AI Rules Setup Automation
echo ================================
echo.
echo [INFO] Source: %SOURCE%
echo [INFO] Target: %TARGET%
echo.

REM Step 1: Copy rules
echo Step 1: Copying AI Rules...
if not exist "%TARGET%\.ai-rules\" mkdir "%TARGET%\.ai-rules"
copy /Y "%SOURCE%rules.md" "%TARGET%\.ai-rules\" >nul 2>&1
if %ERRORLEVEL%==0 echo   [OK] Copied rules.md
copy /Y "%SOURCE%RULES-QUICKREF.md" "%TARGET%\.ai-rules\" >nul 2>&1
if %ERRORLEVEL%==0 echo   [OK] Copied RULES-QUICKREF.md
copy /Y "%SOURCE%README.md" "%TARGET%\.ai-rules\" >nul 2>&1
if %ERRORLEVEL%==0 echo   [OK] Copied README.md
copy /Y "%SOURCE%refactoring.md" "%TARGET%\.ai-rules\" >nul 2>&1
if %ERRORLEVEL%==0 echo   [OK] Copied refactoring.md
copy /Y "%SOURCE%ModularizeCode.md" "%TARGET%\.ai-rules\" >nul 2>&1
if %ERRORLEVEL%==0 echo   [OK] Copied ModularizeCode.md
copy /Y "%SOURCE%RULES-TIERS.md" "%TARGET%\.ai-rules\" >nul 2>&1
if %ERRORLEVEL%==0 echo   [OK] Copied RULES-TIERS.md
copy /Y "%SOURCE%Reference.md" "%TARGET%\.ai-rules\" >nul 2>&1
if %ERRORLEVEL%==0 echo   [OK] Copied Reference.md
copy /Y "%SOURCE%rules-changelog.md" "%TARGET%\.ai-rules\" >nul 2>&1
if %ERRORLEVEL%==0 echo   [OK] Copied rules-changelog.md
copy /Y "%SOURCE%GLOSSARY.md" "%TARGET%\.ai-rules\" >nul 2>&1
if %ERRORLEVEL%==0 echo   [OK] Copied GLOSSARY.md
copy /Y "%SOURCE%LOGGING-OBSERVABILITY.md" "%TARGET%\.ai-rules\" >nul 2>&1
if %ERRORLEVEL%==0 echo   [OK] Copied LOGGING-OBSERVABILITY.md
copy /Y "%SOURCE%token-optimization.md" "%TARGET%\.ai-rules\" >nul 2>&1
if %ERRORLEVEL%==0 echo   [OK] Copied token-optimization.md
copy /Y "%SOURCE%UI-Setup-Instructions.md" "%TARGET%\.ai-rules\" >nul 2>&1
if %ERRORLEVEL%==0 echo   [OK] Copied UI-Setup-Instructions.md
copy /Y "%SOURCE%How_to_use_versioning_badge.md" "%TARGET%\.ai-rules\" >nul 2>&1
if %ERRORLEVEL%==0 echo   [OK] Copied How_to_use_versioning_badge.md

REM Step 2: Copy config templates (optional)
echo.
echo Step 2: Copying configuration templates...
copy /Y "%SOURCE%ai-rules-config.example.json" "%TARGET%\.ai-rules\" >nul 2>&1
if %ERRORLEVEL%==0 echo   [OK] Copied config example
copy /Y "%SOURCE%ai-rules-config.prototype.json" "%TARGET%\.ai-rules\" >nul 2>&1
if %ERRORLEVEL%==0 echo   [OK] Copied prototype config
copy /Y "%SOURCE%ai-rules-config.schema.json" "%TARGET%\.ai-rules\" >nul 2>&1
if %ERRORLEVEL%==0 echo   [OK] Copied config schema

REM Step 2b: Copy automation templates
echo.
echo Step 2b: Copying automation templates...
if not exist "%TARGET%\.ai-rules\templates\github-actions\" mkdir "%TARGET%\.ai-rules\templates\github-actions\"
if not exist "%TARGET%\.ai-rules\templates\pre-commit\" mkdir "%TARGET%\.ai-rules\templates\pre-commit\"
if not exist "%TARGET%\.ai-rules\templates\ethics-safety\" mkdir "%TARGET%\.ai-rules\templates\ethics-safety\"
if not exist "%TARGET%\.ai-rules\templates\ethics-safety\tests\" mkdir "%TARGET%\.ai-rules\templates\ethics-safety\tests\"
copy /Y "%SOURCE%templates\github-actions\ai-rules-checks.yml" "%TARGET%\.ai-rules\templates\github-actions\" >nul 2>&1
if %ERRORLEVEL%==0 echo   [OK] Copied GitHub Actions template
copy /Y "%SOURCE%templates\github-actions\jest-testing-enforcement.yml" "%TARGET%\.ai-rules\templates\github-actions\" >nul 2>&1
if %ERRORLEVEL%==0 echo   [OK] Copied Jest testing enforcement template
copy /Y "%SOURCE%templates\github-actions\pytest-testing-enforcement.yml" "%TARGET%\.ai-rules\templates\github-actions\" >nul 2>&1
if %ERRORLEVEL%==0 echo   [OK] Copied Pytest testing enforcement template
copy /Y "%SOURCE%templates\github-actions\dotnet-testing-enforcement.yml" "%TARGET%\.ai-rules\templates\github-actions\" >nul 2>&1
if %ERRORLEVEL%==0 echo   [OK] Copied .NET testing enforcement template
copy /Y "%SOURCE%templates\github-actions\go-testing-enforcement.yml" "%TARGET%\.ai-rules\templates\github-actions\" >nul 2>&1
if %ERRORLEVEL%==0 echo   [OK] Copied Go testing enforcement template
copy /Y "%SOURCE%templates\pre-commit\pre-commit.sample" "%TARGET%\.ai-rules\templates\pre-commit\" >nul 2>&1
if %ERRORLEVEL%==0 echo   [OK] Copied pre-commit hook template
copy /Y "%SOURCE%templates\pre-commit\validate-ai-rules.ps1" "%TARGET%\.ai-rules\templates\pre-commit\" >nul 2>&1
if %ERRORLEVEL%==0 echo   [OK] Copied pre-commit validator
copy /Y "%SOURCE%templates\pre-commit\validate-jest-tests.ps1" "%TARGET%\.ai-rules\templates\pre-commit\" >nul 2>&1
if %ERRORLEVEL%==0 echo   [OK] Copied Jest pre-commit validator
copy /Y "%SOURCE%templates\pre-commit\validate-pytest-tests.ps1" "%TARGET%\.ai-rules\templates\pre-commit\" >nul 2>&1
if %ERRORLEVEL%==0 echo   [OK] Copied Pytest pre-commit validator
copy /Y "%SOURCE%templates\pre-commit\validate-dotnet-tests.ps1" "%TARGET%\.ai-rules\templates\pre-commit\" >nul 2>&1
if %ERRORLEVEL%==0 echo   [OK] Copied .NET pre-commit validator
copy /Y "%SOURCE%templates\pre-commit\validate-go-tests.ps1" "%TARGET%\.ai-rules\templates\pre-commit\" >nul 2>&1
if %ERRORLEVEL%==0 echo   [OK] Copied Go pre-commit validator
copy /Y "%SOURCE%templates\ethics-safety\bias_detector.py" "%TARGET%\.ai-rules\templates\ethics-safety\" >nul 2>&1
if %ERRORLEVEL%==0 echo   [OK] Copied ethics bias detector starter
copy /Y "%SOURCE%templates\ethics-safety\moderator.py" "%TARGET%\.ai-rules\templates\ethics-safety\" >nul 2>&1
if %ERRORLEVEL%==0 echo   [OK] Copied ethics moderator starter
copy /Y "%SOURCE%templates\ethics-safety\chat_service_middleware.py" "%TARGET%\.ai-rules\templates\ethics-safety\" >nul 2>&1
if %ERRORLEVEL%==0 echo   [OK] Copied chat moderation middleware starter
copy /Y "%SOURCE%templates\ethics-safety\README.md" "%TARGET%\.ai-rules\templates\ethics-safety\" >nul 2>&1
if %ERRORLEVEL%==0 echo   [OK] Copied ethics starter README
copy /Y "%SOURCE%templates\ethics-safety\tests\test_bias_detector.py" "%TARGET%\.ai-rules\templates\ethics-safety\tests\" >nul 2>&1
if %ERRORLEVEL%==0 echo   [OK] Copied ethics bias detector test starter
copy /Y "%SOURCE%templates\ethics-safety\tests\test_moderator.py" "%TARGET%\.ai-rules\templates\ethics-safety\tests\" >nul 2>&1
if %ERRORLEVEL%==0 echo   [OK] Copied ethics moderator test starter
copy /Y "%SOURCE%templates\ethics-safety\tests\test_chat_service_middleware.py" "%TARGET%\.ai-rules\templates\ethics-safety\tests\" >nul 2>&1
if %ERRORLEVEL%==0 echo   [OK] Copied chat middleware test starter

REM Step 3: GitHub Copilot instructions
echo.
echo Step 3: Setting up GitHub Copilot instructions...
if not exist "%TARGET%\.github\" mkdir "%TARGET%\.github"
copy /Y "%SOURCE%.github\copilot-instructions.md" "%TARGET%\.github\" >nul 2>&1
if %ERRORLEVEL%==0 echo   [OK] Created copilot-instructions.md

REM Step 4: VS Code tasks (use target-specific template)
echo.
echo Step 4: Setting up VS Code tasks...
if not exist "%TARGET%\.vscode\" mkdir "%TARGET%\.vscode"
if exist "%SOURCE%.vscode\tasks.target.json" (
    copy /Y "%SOURCE%.vscode\tasks.target.json" "%TARGET%\.vscode\tasks.json" >nul 2>&1
    if %ERRORLEVEL%==0 echo   [OK] Created tasks.json from target template
) else (
    copy /Y "%SOURCE%.vscode\tasks.json" "%TARGET%\.vscode\tasks.json" >nul 2>&1
    if %ERRORLEVEL%==0 echo   [OK] Created tasks.json
)

echo.
echo ================================
echo [SUCCESS] AI Rules setup complete!
echo.
echo Files created:
echo   - .ai-rules/rules.md
echo   - .ai-rules/RULES-QUICKREF.md
echo   - .ai-rules/README.md
echo   - .ai-rules/refactoring.md
echo   - .ai-rules/ModularizeCode.md
echo   - .ai-rules/RULES-TIERS.md
echo   - .ai-rules/Reference.md
echo   - .ai-rules/rules-changelog.md
echo   - .ai-rules/GLOSSARY.md
echo   - .ai-rules/LOGGING-OBSERVABILITY.md
echo   - .ai-rules/token-optimization.md
echo   - .ai-rules/UI-Setup-Instructions.md
echo   - .ai-rules/How_to_use_versioning_badge.md
echo   - .ai-rules/ai-rules-config.example.json
echo   - .ai-rules/ai-rules-config.prototype.json
echo   - .ai-rules/ai-rules-config.schema.json
echo   - .ai-rules/templates/github-actions/ai-rules-checks.yml
echo   - .ai-rules/templates/github-actions/jest-testing-enforcement.yml
echo   - .ai-rules/templates/github-actions/pytest-testing-enforcement.yml
echo   - .ai-rules/templates/github-actions/dotnet-testing-enforcement.yml
echo   - .ai-rules/templates/github-actions/go-testing-enforcement.yml
echo   - .ai-rules/templates/pre-commit/pre-commit.sample
echo   - .ai-rules/templates/pre-commit/validate-ai-rules.ps1
echo   - .ai-rules/templates/pre-commit/validate-jest-tests.ps1
echo   - .ai-rules/templates/pre-commit/validate-pytest-tests.ps1
echo   - .ai-rules/templates/pre-commit/validate-dotnet-tests.ps1
echo   - .ai-rules/templates/pre-commit/validate-go-tests.ps1
echo   - .ai-rules/templates/ethics-safety/bias_detector.py
echo   - .ai-rules/templates/ethics-safety/moderator.py
echo   - .ai-rules/templates/ethics-safety/chat_service_middleware.py
echo   - .ai-rules/templates/ethics-safety/README.md
echo   - .ai-rules/templates/ethics-safety/tests/test_bias_detector.py
echo   - .ai-rules/templates/ethics-safety/tests/test_moderator.py
echo   - .ai-rules/templates/ethics-safety/tests/test_chat_service_middleware.py
echo   - .github/copilot-instructions.md
echo   - .vscode/tasks.json
echo.
echo Next: Open the project in VS Code and start coding!
echo.

endlocal
*** Add File: c:\Users\Lee Metzger\Desktop\AI Rules\templates\ethics-safety\bias_detector.py
from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Iterable, Mapping, Sequence


PROTECTED_ATTRIBUTES: tuple[str, ...] = (
    "gender",
    "racial",
    "cultural",
    "age",
    "disability",
    "socioeconomic",
)

BIAS_PATTERN_CATEGORIES: tuple[str, ...] = (
    "exclusionary_language",
    "comparative_inferiority",
    "capability_assumptions",
    "coded_discrimination",
    "cultural_erasure",
)

STEREOTYPE_CATEGORIES: tuple[str, ...] = (
    "gender_stereotype",
    "racial_stereotype",
    "socioeconomic_stereotype",
)


@dataclass(frozen=True)
class SeverityThresholds:
    """Map numeric bias scores onto human-readable severity labels.

    Purpose:
        Centralize severity thresholds so teams can calibrate what low,
        medium, high, and critical bias scores mean for their project.

    Inputs:
        low: Minimum score that should be treated as a low-severity concern.
        medium: Minimum score that requires explicit review.
        high: Minimum score that should trigger strong mitigation.
        critical: Minimum score that should block release or display.

    Outputs:
        Instances are consumed by AdvancedBiasDetector.severity_for_score.

    Side Effects:
        None.

    Errors:
        No runtime validation is performed in the template; callers should keep
        thresholds ascending.

    Performance:
        O(1) lookups.

    Security/Privacy:
        Stores only numeric policy data.

    AI/Ethics/Fairness:
        This object defines the policy boundary between informative findings
        and findings that require mitigation, review, or blocking.

    Concurrency:
        Immutable and safe to share across threads.

    Rationale:
        Using a dataclass keeps policy explicit and easy to override in config.
    """

    low: float = 0.15
    medium: float = 0.35
    high: float = 0.60
    critical: float = 0.85

    def severity_for_score(self, score: float) -> str:
        """Return the severity label for a normalized score."""
        if score >= self.critical:
            return "critical"
        if score >= self.high:
            return "high"
        if score >= self.medium:
            return "medium"
        if score >= self.low:
            return "low"
        return "none"


@dataclass(frozen=True)
class FairnessRecord:
    """Represent one outcome used for fairness-metric calculations.

    Purpose:
        Capture the minimum data needed to compute demographic parity and equal
        opportunity across protected groups.

    Inputs:
        group: Protected-group label, such as "gender:women".
        predicted_positive: Whether the system produced a positive outcome.
        actual_positive: Ground-truth positive status when available.

    Outputs:
        Instances are consumed by AdvancedBiasDetector.compute_fairness_metrics.

    Side Effects:
        None.

    Errors:
        None.

    Performance:
        O(1) storage per record.

    Security/Privacy:
        Use coarse-grained group labels rather than direct identifiers.

    AI/Ethics/Fairness:
        These records support group-level fairness analysis without requiring
        raw prompts or personally identifiable details.

    Concurrency:
        Immutable and safe to share.

    Rationale:
        A minimal record keeps the starter portable across apps and schemas.
    """

    group: str
    predicted_positive: bool
    actual_positive: bool | None = None


@dataclass(frozen=True)
class PatternDefinition:
    """Describe one bias or stereotype pattern rule."""

    name: str
    category: str
    expression: re.Pattern[str]
    weight: float
    explanation: str


@dataclass(frozen=True)
class BiasFinding:
    """Represent one matched bias pattern with score metadata."""

    category: str
    finding_type: str
    pattern_name: str
    excerpt: str
    score: float
    severity: str
    confidence: str
    explanation: str


@dataclass(frozen=True)
class FairnessMetrics:
    """Capture fairness metrics derived from grouped outcomes."""

    demographic_parity_difference: float
    equal_opportunity_difference: float | None
    selection_rates: Mapping[str, float]
    true_positive_rates: Mapping[str, float]


@dataclass(frozen=True)
class BiasAssessment:
    """Provide the full result of a bias-analysis pass."""

    severity: str
    confidence: str
    score: float
    findings: Sequence[BiasFinding] = field(default_factory=tuple)
    fairness_metrics: FairnessMetrics | None = None
    recommendations: Sequence[str] = field(default_factory=tuple)
    protected_attributes_reviewed: Sequence[str] = field(default_factory=lambda: PROTECTED_ATTRIBUTES)


def _compile(expression: str) -> re.Pattern[str]:
    """Compile a case-insensitive regex for starter pattern rules."""
    return re.compile(expression, re.IGNORECASE)


PATTERN_LIBRARY: tuple[PatternDefinition, ...] = (
    PatternDefinition(
        name="group_exclusion",
        category="exclusionary_language",
        expression=_compile(r"\b(?:those|these)\s+(?:people|women|men|immigrants|disabled people)\s+(?:do not belong|should stay away)\b"),
        weight=0.40,
        explanation="Direct exclusionary framing of a group.",
    ),
    PatternDefinition(
        name="group_inferiority",
        category="comparative_inferiority",
        expression=_compile(r"\b(?:women|men|immigrants|older people|disabled people|poor people)\s+(?:are|tend to be)\s+(?:inferior|less capable|less intelligent|lazy)\b"),
        weight=0.35,
        explanation="Claims inherent inferiority for a protected or vulnerable group.",
    ),
    PatternDefinition(
        name="capability_restriction",
        category="capability_assumptions",
        expression=_compile(r"\b(?:women|older people|disabled people|poor people)\s+(?:cannot|can't|shouldn't)\s+(?:lead|learn|decide|work in)\b"),
        weight=0.30,
        explanation="Assumes a group lacks ability for a role or task.",
    ),
    PatternDefinition(
        name="coded_discrimination",
        category="coded_discrimination",
        expression=_compile(r"\b(?:not our kind of people|bad neighborhood types|real americans only|not a culture fit)\b"),
        weight=0.28,
        explanation="Uses coded language to exclude groups indirectly.",
    ),
    PatternDefinition(
        name="cultural_erasure",
        category="cultural_erasure",
        expression=_compile(r"\b(?:speak normal english|civilized people|real culture|proper family values)\b"),
        weight=0.24,
        explanation="Frames one culture as the only valid norm.",
    ),
    PatternDefinition(
        name="gender_stereotype",
        category="gender_stereotype",
        expression=_compile(r"\b(?:women are naturally better at caregiving|men are natural leaders|girls are too emotional)\b"),
        weight=0.22,
        explanation="Applies a rigid gender stereotype.",
    ),
    PatternDefinition(
        name="racial_stereotype",
        category="racial_stereotype",
        expression=_compile(r"\b(?:that race is naturally violent|those people are born criminals|they all look alike)\b"),
        weight=0.45,
        explanation="Applies a racial stereotype or dehumanizing generalization.",
    ),
    PatternDefinition(
        name="socioeconomic_stereotype",
        category="socioeconomic_stereotype",
        expression=_compile(r"\b(?:poor people are lazy|rich people are always smarter|working class people do not understand)\b"),
        weight=0.22,
        explanation="Applies a socioeconomic stereotype.",
    ),
)


class AdvancedBiasDetector:
    """Analyze text and grouped outcomes for bias and fairness risks.

    Purpose:
        Provide a starter implementation that combines pattern-based bias
        detection with fairness metrics and mitigation recommendations.

    Inputs:
        thresholds: Policy thresholds used to classify severity.
        protected_attributes: Ordered set of protected attributes that the
            detector should document as reviewed.

    Outputs:
        analyze_text returns BiasAssessment with findings, scores, fairness
        metrics, and recommended mitigations.

    Side Effects:
        None. The detector is pure and returns structured results.

    Errors:
        None by default. Empty inputs return a no-finding assessment.

    Performance:
        O(p + r) where p is the number of regex patterns and r is the number of
        fairness records. Suitable for request-time checks on moderate text.

    Security/Privacy:
        Does not store prompts or outcomes beyond the returned result. Callers
        should redact raw excerpts before external logging if needed.

    AI/Ethics/Fairness:
        Covers gender, racial, cultural, age, disability, and socioeconomic
        concerns, plus demographic parity and equal opportunity.

    Concurrency:
        Safe for concurrent use because the class holds immutable configuration.

    Rationale:
        The template avoids third-party dependencies so teams can adapt it in a
        new repo before deciding whether to migrate to specialized tooling.
    """

    def __init__(
        self,
        *,
        thresholds: SeverityThresholds | None = None,
        protected_attributes: Sequence[str] = PROTECTED_ATTRIBUTES,
    ) -> None:
        self.thresholds = thresholds or SeverityThresholds()
        self.protected_attributes = tuple(protected_attributes)

    def analyze_text(
        self,
        text: str,
        *,
        fairness_records: Iterable[FairnessRecord] | None = None,
    ) -> BiasAssessment:
        """Analyze text and optional fairness records for bias concerns.

        Args:
            text: User-visible or model-generated text to inspect.
            fairness_records: Optional grouped outcomes for fairness metrics.

        Returns:
            BiasAssessment describing findings, fairness metrics, severity,
            confidence, and mitigation recommendations.

        Raises:
            None.

        Side Effects:
            None.

        Performance:
            O(p + r) over pattern count and fairness-record count.

        Security/Privacy:
            Returns matched excerpts; callers should redact or hash them before
            writing to long-term logs.

        AI/Ethics/Fairness:
            This method is the main entry point for text-level bias analysis and
            optional fairness auditing.

        Concurrency:
            Safe for concurrent calls.

        Rationale:
            Bundling text and fairness signals in one result makes it easier for
            moderation systems to produce a single review decision.
        """
        findings = self._scan_patterns(text)
        fairness_metrics = None
        fairness_score = 0.0

        if fairness_records is not None:
            fairness_metrics = self.compute_fairness_metrics(tuple(fairness_records))
            fairness_components = [abs(fairness_metrics.demographic_parity_difference)]
            if fairness_metrics.equal_opportunity_difference is not None:
                fairness_components.append(abs(fairness_metrics.equal_opportunity_difference))
            fairness_score = max(fairness_components, default=0.0)

        pattern_score = min(1.0, sum(finding.score for finding in findings))
        combined_score = min(1.0, max(pattern_score, fairness_score))
        severity = self.thresholds.severity_for_score(combined_score)
        confidence = self._confidence_for(findings, fairness_score)
        recommendations = self._recommendations_for(findings, fairness_metrics, severity)

        return BiasAssessment(
            severity=severity,
            confidence=confidence,
            score=combined_score,
            findings=tuple(findings),
            fairness_metrics=fairness_metrics,
            recommendations=tuple(recommendations),
            protected_attributes_reviewed=self.protected_attributes,
        )

    def compute_fairness_metrics(self, records: Sequence[FairnessRecord]) -> FairnessMetrics:
        """Compute demographic parity and equal opportunity by group.

        Args:
            records: Grouped outcomes produced by the application.

        Returns:
            FairnessMetrics with per-group rates and max-min differences.

        Raises:
            None. Empty inputs return zeroed metrics.

        Side Effects:
            None.

        Performance:
            O(r) in the number of records.

        Security/Privacy:
            Operates on aggregate group labels rather than direct identifiers.

        AI/Ethics/Fairness:
            Demographic parity captures selection-rate spread; equal
            opportunity captures true-positive-rate spread where labels exist.

        Concurrency:
            Pure and safe for concurrent use.

        Rationale:
            These two metrics are common, easy-to-explain starters for fairness
            discussions with product and compliance teams.
        """
        if not records:
            return FairnessMetrics(0.0, None, {}, {})

        totals: dict[str, int] = defaultdict(int)
        positives: dict[str, int] = defaultdict(int)
        actual_positives: dict[str, int] = defaultdict(int)
        true_positives: dict[str, int] = defaultdict(int)

        for record in records:
            totals[record.group] += 1
            if record.predicted_positive:
                positives[record.group] += 1
            if record.actual_positive:
                actual_positives[record.group] += 1
                if record.predicted_positive:
                    true_positives[record.group] += 1

        selection_rates = {
            group: positives[group] / totals[group]
            for group in totals
            if totals[group]
        }
        demographic_parity = self._spread(selection_rates)

        true_positive_rates = {
            group: true_positives[group] / actual_positives[group]
            for group in actual_positives
            if actual_positives[group]
        }
        equal_opportunity = self._spread(true_positive_rates) if true_positive_rates else None

        return FairnessMetrics(
            demographic_parity_difference=demographic_parity,
            equal_opportunity_difference=equal_opportunity,
            selection_rates=selection_rates,
            true_positive_rates=true_positive_rates,
        )

    def _scan_patterns(self, text: str) -> list[BiasFinding]:
        findings: list[BiasFinding] = []
        excerpt_source = text.strip() or ""

        for pattern in PATTERN_LIBRARY:
            match = pattern.expression.search(excerpt_source)
            if not match:
                continue
            score = min(1.0, pattern.weight)
            severity = self.thresholds.severity_for_score(score)
            findings.append(
                BiasFinding(
                    category=pattern.category,
                    finding_type=(
                        "stereotype_pattern"
                        if pattern.category in STEREOTYPE_CATEGORIES
                        else "bias_pattern"
                    ),
                    pattern_name=pattern.name,
                    excerpt=match.group(0),
                    score=score,
                    severity=severity,
                    confidence=self._confidence_from_score(score),
                    explanation=pattern.explanation,
                )
            )

        return findings

    def _recommendations_for(
        self,
        findings: Sequence[BiasFinding],
        fairness_metrics: FairnessMetrics | None,
        severity: str,
    ) -> list[str]:
        recommendations: list[str] = []

        finding_categories = {finding.category for finding in findings}
        if finding_categories:
            recommendations.append(
                "Review the flagged wording, replace group-based generalizations, and add safer prompt or response constraints."
            )
        if "comparative_inferiority" in finding_categories or "racial_stereotype" in finding_categories:
            recommendations.append(
                "Escalate to human review and remove claims of inherent superiority or inferiority."
            )
        if "coded_discrimination" in finding_categories or "cultural_erasure" in finding_categories:
            recommendations.append(
                "Rewrite criteria so they describe job, product, or safety requirements without proxy language."
            )

        if fairness_metrics is not None:
            if abs(fairness_metrics.demographic_parity_difference) >= self.thresholds.medium:
                recommendations.append(
                    "Rebalance data or decision rules to reduce demographic parity gaps between protected groups."
                )
            if fairness_metrics.equal_opportunity_difference is not None and abs(fairness_metrics.equal_opportunity_difference) >= self.thresholds.medium:
                recommendations.append(
                    "Inspect false-negative patterns by group and add targeted evaluation before release."
                )

        if severity in {"high", "critical"}:
            recommendations.append(
                "Block or hold the response until mitigation and review are completed."
            )

        if not recommendations:
            recommendations.append(
                "No immediate mitigation required, but keep the detector enabled and monitor drift over time."
            )

        return recommendations

    def _confidence_for(self, findings: Sequence[BiasFinding], fairness_score: float) -> str:
        if len(findings) >= 2 or fairness_score >= self.thresholds.high:
            return "high"
        if findings or fairness_score >= self.thresholds.medium:
            return "medium"
        return "low"

    @staticmethod
    def _confidence_from_score(score: float) -> str:
        if score >= 0.40:
            return "high"
        if score >= 0.20:
            return "medium"
        return "low"

    @staticmethod
    def _spread(group_rates: Mapping[str, float]) -> float:
        if not group_rates:
            return 0.0
        values = tuple(group_rates.values())
        return max(values) - min(values)
*** Add File: c:\Users\Lee Metzger\Desktop\AI Rules\templates\ethics-safety\moderator.py
from __future__ import annotations

import re
from dataclasses import dataclass, field, replace
from typing import Sequence

from bias_detector import AdvancedBiasDetector, BiasAssessment


SEVERITY_ORDER: dict[str, int] = {
    "low": 0,
    "medium": 1,
    "high": 2,
    "critical": 3,
}


@dataclass(frozen=True)
class ModerationIssue:
    """Represent one moderation concern discovered in a response.

    Purpose:
        Provide a uniform issue shape for harmful content, misinformation,
        privacy, and bias findings.

    Inputs:
        category: Issue family such as "violence" or "bias".
        severity: Normalized severity label.
        confidence: Confidence label for the detection.
        reason: Human-readable explanation of the issue.
        excerpt: Matching excerpt or a redacted snippet.
        source: Detector that produced the issue.

    Outputs:
        Instances are collected in ModerationResult.issues.

    Side Effects:
        None.

    Errors:
        None.

    Performance:
        O(1) storage per issue.

    Security/Privacy:
        Callers should redact excerpts before external persistence when needed.

    AI/Ethics/Fairness:
        Normalizing all issue types into one structure supports consistent
        review and escalation policy.

    Concurrency:
        Immutable and safe to share.

    Rationale:
        A single issue shape simplifies logging, dashboards, and review queues.
    """

    category: str
    severity: str
    confidence: str
    reason: str
    excerpt: str
    source: str


@dataclass(frozen=True)
class ModerationResult:
    """Capture the final moderation outcome for a piece of content."""

    decision: str
    issues: Sequence[ModerationIssue] = field(default_factory=tuple)
    safe_fallback: str = "I can't provide that response, but I can help with a safer alternative."
    bias_assessment: BiasAssessment | None = None


def _compile(expression: str) -> re.Pattern[str]:
    """Compile a case-insensitive regex for moderation rules."""
    return re.compile(expression, re.IGNORECASE)


class ContentModerator:
    """Layer harmful-content, privacy, misinformation, and bias checks.

    Purpose:
        Provide a starter moderation engine that can run before AI responses are
        displayed to end users.

    Inputs:
        bias_detector: Detector used for advanced bias analysis.
        review_threshold: Lowest severity that requires human review.
        block_threshold: Lowest severity that must be blocked.

    Outputs:
        moderate returns a ModerationResult containing the final decision,
        issues, safe fallback, and underlying bias assessment.

    Side Effects:
        None. Logging is deferred to middleware so the caller can control log
        sinks and redaction policy.

    Errors:
        None. Empty or harmless content returns an allow decision.

    Performance:
        O(r + p) over regex rules and bias checks; suitable for request-time
        moderation in moderate throughput services.

    Security/Privacy:
        Includes basic detection for email, phone, SSN, and address-like data.

    AI/Ethics/Fairness:
        Implements severity-based approval, context-aware allowances, and bias
        integration so safety policy is enforced consistently.

    Concurrency:
        Safe for concurrent use because rule sets are immutable.

    Rationale:
        Combining all moderation layers in one class produces one actionable
        decision for the chat-service integration point.
    """

    HARMFUL_RULES: dict[str, tuple[re.Pattern[str], str, str]] = {
        "hate_speech": (
            _compile(r"\b(?:kill all|exterminate|subhuman)\b"),
            "critical",
            "Detected language associated with hate or dehumanization.",
        ),
        "violence": (
            _compile(r"\b(?:shoot them|stab them|violent revenge|bomb the)\b"),
            "critical",
            "Detected explicit violent intent or instructions.",
        ),
        "sexual_harassment": (
            _compile(r"\b(?:coerce her|harass them sexually|force sexual)\b"),
            "critical",
            "Detected sexual harassment or coercive language.",
        ),
        "discrimination": (
            _compile(r"\b(?:refuse service to|ban .* from working here|do not hire .* because)\b"),
            "high",
            "Detected discriminatory instructions or exclusion.",
        ),
    }

    MISINFORMATION_RULES: tuple[tuple[re.Pattern[str], str], ...] = (
        (_compile(r"\b(?:guaranteed cure|always true|never wrong)\b"), "Absolute claim without evidence."),
        (_compile(r"\b(?:scientists proved it without evidence|everyone knows this is true)\b"), "Unverified claim presented as settled fact."),
    )

    PRIVACY_RULES: tuple[tuple[re.Pattern[str], str], ...] = (
        (_compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b"), "Detected an email address."),
        (_compile(r"\b\d{3}-\d{2}-\d{4}\b"), "Detected a U.S. SSN pattern."),
        (_compile(r"\b\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b"), "Detected a phone number."),
        (_compile(r"\b\d{1,5}\s+[A-Z0-9.\s]+(?:street|st|road|rd|avenue|ave|drive|dr)\b"), "Detected address-like location data."),
    )

    TECHNICAL_ALLOWANCES: tuple[re.Pattern[str], ...] = (
        _compile(r"\bkill (?:the )?process\b"),
        _compile(r"\bterminate (?:the )?thread\b"),
        _compile(r"\battack surface\b"),
        _compile(r"\bpenetration test\b"),
        _compile(r"\bexploit mitigation\b"),
    )

    def __init__(
        self,
        *,
        bias_detector: AdvancedBiasDetector | None = None,
        review_threshold: str = "medium",
        block_threshold: str = "critical",
    ) -> None:
        self.bias_detector = bias_detector or AdvancedBiasDetector()
        self.review_threshold = review_threshold
        self.block_threshold = block_threshold

    def moderate(self, content: str, *, context: str = "general") -> ModerationResult:
        """Moderate a response before it is displayed or stored.

        Args:
            content: Candidate response text.
            context: Optional context label such as "general", "technical",
                or "safety".

        Returns:
            ModerationResult with allow, review, or block decision.

        Raises:
            None.

        Side Effects:
            None.

        Performance:
            O(r + p) over rule and bias pattern counts.

        Security/Privacy:
            Detects basic PII and address-like content before display.

        AI/Ethics/Fairness:
            Applies severity-based approval and routes ambiguous cases to
            review instead of silently allowing them.

        Concurrency:
            Safe for concurrent calls.

        Rationale:
            One method returns the final policy decision for middleware and UIs.
        """
        issues = []
        issues.extend(self._detect_harmful_content(content))
        issues.extend(self._detect_misinformation(content))
        issues.extend(self._detect_privacy(content))

        bias_assessment = self.bias_detector.analyze_text(content)
        for finding in bias_assessment.findings:
            issues.append(
                ModerationIssue(
                    category="bias",
                    severity=finding.severity,
                    confidence=finding.confidence,
                    reason=finding.explanation,
                    excerpt=finding.excerpt,
                    source="bias_detector",
                )
            )

        if bias_assessment.severity in {"high", "critical"} and not bias_assessment.findings:
            issues.append(
                ModerationIssue(
                    category="bias",
                    severity=bias_assessment.severity,
                    confidence=bias_assessment.confidence,
                    reason="Fairness metrics exceeded the configured mitigation threshold.",
                    excerpt="fairness_metrics",
                    source="bias_detector",
                )
            )

        adjusted_issues = self._apply_context_allowances(tuple(issues), content, context)
        decision = self._decision_for(adjusted_issues)

        return ModerationResult(
            decision=decision,
            issues=adjusted_issues,
            safe_fallback=self._fallback_for(decision),
            bias_assessment=bias_assessment,
        )

    def _detect_harmful_content(self, content: str) -> list[ModerationIssue]:
        issues: list[ModerationIssue] = []
        for category, (pattern, severity, reason) in self.HARMFUL_RULES.items():
            match = pattern.search(content)
            if not match:
                continue
            issues.append(
                ModerationIssue(
                    category=category,
                    severity=severity,
                    confidence="high",
                    reason=reason,
                    excerpt=match.group(0),
                    source="harmful_content_rule",
                )
            )
        return issues

    def _detect_misinformation(self, content: str) -> list[ModerationIssue]:
        issues: list[ModerationIssue] = []
        for pattern, reason in self.MISINFORMATION_RULES:
            match = pattern.search(content)
            if not match:
                continue
            issues.append(
                ModerationIssue(
                    category="misinformation",
                    severity="medium",
                    confidence="medium",
                    reason=reason,
                    excerpt=match.group(0),
                    source="misinformation_rule",
                )
            )
        return issues

    def _detect_privacy(self, content: str) -> list[ModerationIssue]:
        issues: list[ModerationIssue] = []
        for pattern, reason in self.PRIVACY_RULES:
            match = pattern.search(content)
            if not match:
                continue
            issues.append(
                ModerationIssue(
                    category="privacy",
                    severity="high",
                    confidence="high",
                    reason=reason,
                    excerpt=match.group(0),
                    source="privacy_rule",
                )
            )
        return issues

    def _apply_context_allowances(
        self,
        issues: Sequence[ModerationIssue],
        content: str,
        context: str,
    ) -> tuple[ModerationIssue, ...]:
        if context not in {"technical", "safety", "security"}:
            return tuple(issues)
        if not any(pattern.search(content) for pattern in self.TECHNICAL_ALLOWANCES):
            return tuple(issues)

        adjusted: list[ModerationIssue] = []
        for issue in issues:
            if issue.category not in {"violence", "hate_speech"}:
                adjusted.append(issue)
                continue
            lowered = self._downgrade(issue.severity)
            adjusted.append(
                replace(
                    issue,
                    severity=lowered,
                    confidence="medium",
                    reason=f"Context allowance applied for {context} discussion. {issue.reason}",
                )
            )
        return tuple(adjusted)

    def _decision_for(self, issues: Sequence[ModerationIssue]) -> str:
        if not issues:
            return "allow"

        highest = max(issues, key=lambda issue: SEVERITY_ORDER[issue.severity]).severity
        if SEVERITY_ORDER[highest] >= SEVERITY_ORDER[self.block_threshold]:
            return "block"
        if SEVERITY_ORDER[highest] >= SEVERITY_ORDER[self.review_threshold]:
            return "review"
        return "allow"

    @staticmethod
    def _fallback_for(decision: str) -> str:
        if decision == "block":
            return "I can't provide that response, but I can help with a safer alternative or a high-level explanation."
        if decision == "review":
            return "This response needs review before it can be shown. I can help rewrite it in a safer, better-supported form."
        return ""

    @staticmethod
    def _downgrade(severity: str) -> str:
        if severity == "critical":
            return "high"
        if severity == "high":
            return "medium"
        if severity == "medium":
            return "low"
        return severity
*** Add File: c:\Users\Lee Metzger\Desktop\AI Rules\templates\ethics-safety\chat_service_middleware.py
from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass, field
from typing import Callable, Mapping, Protocol

from moderator import ContentModerator, ModerationResult


LOGGER = logging.getLogger(__name__)


class ChatService(Protocol):
    """Minimal protocol for a chat service used by the middleware."""

    def generate_response(self, prompt: str, *, context: str = "general") -> str:
        """Return the raw model response for a prompt."""


ReviewHandler = Callable[[ModerationResult], bool]


@dataclass(frozen=True)
class ModeratedResponse:
    """Represent a moderated chat response returned to the caller.

    Purpose:
        Preserve both the visible content and the moderation metadata needed by
        UI, observability, and manual-review pipelines.

    Inputs:
        content: Final content shown or returned to the caller.
        decision: Final moderation decision.
        blocked: Whether the original response was blocked.
        review_required: Whether manual review was required.
        generation_time_ms: Time spent generating the raw response.
        moderation_time_ms: Time spent moderating the response.
        total_time_ms: Total end-to-end processing time.
        issue_count: Number of moderation issues discovered.
        metadata: Optional request metadata to carry downstream.

    Outputs:
        Immutable response envelope for callers.

    Side Effects:
        None.

    Errors:
        None.

    Performance:
        O(1) storage beyond the underlying content.

    Security/Privacy:
        Metadata should avoid raw PII unless separately protected.

    AI/Ethics/Fairness:
        Makes review and block state explicit so unsafe outputs do not leak
        through a plain string interface.

    Concurrency:
        Immutable and safe to share.

    Rationale:
        A structured response keeps transport, UI, and review behavior aligned.
    """

    content: str
    decision: str
    blocked: bool
    review_required: bool
    generation_time_ms: float
    moderation_time_ms: float
    total_time_ms: float
    issue_count: int
    metadata: Mapping[str, str] = field(default_factory=dict)


class ChatModerationMiddleware:
    """Wrap a chat service with response-time moderation and telemetry.

    Purpose:
        Ensure every AI response is moderated before display, with safe
        fallbacks, structured logs, and timing metrics.

    Inputs:
        chat_service: Underlying chat service that produces raw responses.
        moderator: ContentModerator used to analyze generated text.
        review_handler: Optional callback for manual or asynchronous review.
        logger: Optional logger override.

    Outputs:
        generate_response returns ModeratedResponse with content and metadata.

    Side Effects:
        Emits structured log events for decisions, issue counts, and timing.

    Errors:
        Exceptions from the underlying service are not swallowed; callers should
        layer their own retry or circuit-breaker logic if needed.

    Performance:
        Adds one moderation pass plus lightweight log redaction on top of model
        generation time.

    Security/Privacy:
        Redacts basic email, phone, and SSN patterns before log emission.

    AI/Ethics/Fairness:
        Enforces the policy that blocked content never reaches the UI and
        reviewed content is held unless a reviewer explicitly approves it.

    Concurrency:
        Safe for concurrent use when the wrapped chat_service is itself safe.

    Rationale:
        Centralizing moderation in middleware reduces the risk of callers
        bypassing safety checks in individual endpoints or UI surfaces.
    """

    def __init__(
        self,
        chat_service: ChatService,
        *,
        moderator: ContentModerator | None = None,
        review_handler: ReviewHandler | None = None,
        logger: logging.Logger | None = None,
    ) -> None:
        self.chat_service = chat_service
        self.moderator = moderator or ContentModerator()
        self.review_handler = review_handler
        self.logger = logger or LOGGER

    def generate_response(
        self,
        prompt: str,
        *,
        context: str = "general",
        metadata: Mapping[str, str] | None = None,
    ) -> ModeratedResponse:
        """Generate, moderate, and return a safe chat response.

        Args:
            prompt: User prompt sent to the underlying chat service.
            context: Moderation context, such as "general" or "technical".
            metadata: Optional request metadata to attach to the response.

        Returns:
            ModeratedResponse with the visible content and moderation metadata.

        Raises:
            Any exception raised by the underlying chat service.

        Side Effects:
            Writes a structured log event for the moderation decision.

        Performance:
            O(g + m) where g is generation time and m is moderation time.

        Security/Privacy:
            Prompt and response previews are redacted before logging.

        AI/Ethics/Fairness:
            This is the main integration point that ensures every response is
            moderated before it is displayed or persisted.

        Concurrency:
            Safe for concurrent calls if the wrapped service is safe.

        Rationale:
            A single gateway makes moderation auditable and hard to bypass.
        """
        request_metadata = dict(metadata or {})
        started = time.perf_counter()

        generation_started = time.perf_counter()
        raw_response = self.chat_service.generate_response(prompt, context=context)
        generation_time_ms = round((time.perf_counter() - generation_started) * 1000, 2)

        moderation_started = time.perf_counter()
        moderation = self.moderator.moderate(raw_response, context=context)
        moderation_time_ms = round((time.perf_counter() - moderation_started) * 1000, 2)
        total_time_ms = round((time.perf_counter() - started) * 1000, 2)

        review_required = moderation.decision == "review"
        blocked = moderation.decision == "block"
        visible_content = raw_response

        if blocked:
            visible_content = moderation.safe_fallback
        elif review_required:
            approved = self.review_handler(moderation) if self.review_handler else False
            if not approved:
                visible_content = moderation.safe_fallback
                blocked = True
            review_required = True

        self.logger.info(
            "chat_response_moderated",
            extra={
                "decision": moderation.decision,
                "blocked": blocked,
                "review_required": review_required,
                "issue_count": len(moderation.issues),
                "issue_categories": [issue.category for issue in moderation.issues],
                "generation_time_ms": generation_time_ms,
                "moderation_time_ms": moderation_time_ms,
                "total_time_ms": total_time_ms,
                "prompt_preview": self._redact_for_logs(prompt),
                "response_preview": self._redact_for_logs(raw_response),
                "metadata": request_metadata,
            },
        )

        return ModeratedResponse(
            content=visible_content,
            decision=moderation.decision,
            blocked=blocked,
            review_required=review_required,
            generation_time_ms=generation_time_ms,
            moderation_time_ms=moderation_time_ms,
            total_time_ms=total_time_ms,
            issue_count=len(moderation.issues),
            metadata=request_metadata,
        )

    @staticmethod
    def _redact_for_logs(text: str) -> str:
        """Redact simple PII patterns before writing log previews."""
        redacted = re.sub(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", "[redacted-email]", text, flags=re.IGNORECASE)
        redacted = re.sub(r"\b\d{3}-\d{2}-\d{4}\b", "[redacted-ssn]", redacted)
        redacted = re.sub(r"\b\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b", "[redacted-phone]", redacted)
        return redacted[:160]
*** Add File: c:\Users\Lee Metzger\Desktop\AI Rules\templates\ethics-safety\README.md
# Ethics Safety Starters

These files are starter templates for teams implementing the ethics framework described in `rules.md` §24.

## Included Files

- `bias_detector.py`: Pattern-based bias detection plus demographic parity and equal opportunity helpers.
- `moderator.py`: Harmful-content, misinformation, privacy, and bias moderation in one decision layer.
- `chat_service_middleware.py`: Response-time moderation wrapper with safe fallbacks and structured logging.
- `tests/`: Minimal `unittest` examples showing how to validate the starters.

## How to Use

1. Copy the starter files into your application source tree.
2. Replace the regex patterns with domain-specific rules and representative examples from your product.
3. Tune severity thresholds and review/block policy using real prompts and response samples.
4. Connect the middleware to your actual logging, tracing, and human-review workflow.
5. Adapt the tests to your app's packaging and CI runner.

## Production Notes

- Treat these as examples, not audited production libraries.
- Redact prompts and responses before long-term logging if they can contain sensitive data.
- Keep context-aware allowances narrow and documented so technical exceptions do not become broad bypasses.
- Revisit pattern libraries and thresholds regularly to detect policy drift.
*** Add File: c:\Users\Lee Metzger\Desktop\AI Rules\templates\ethics-safety\tests\test_bias_detector.py
from __future__ import annotations

import pathlib
import sys
import unittest


TEMPLATE_ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(TEMPLATE_ROOT) not in sys.path:
    sys.path.insert(0, str(TEMPLATE_ROOT))


from bias_detector import AdvancedBiasDetector, FairnessRecord


class AdvancedBiasDetectorTests(unittest.TestCase):
    def test_detects_stereotype_language(self) -> None:
        detector = AdvancedBiasDetector()

        assessment = detector.analyze_text(
            "Women are naturally better at caregiving and men are natural leaders."
        )

        self.assertEqual("low", assessment.severity)
        self.assertTrue(assessment.findings)
        self.assertIn("gender_stereotype", {finding.category for finding in assessment.findings})

    def test_calculates_fairness_metrics(self) -> None:
        detector = AdvancedBiasDetector()
        records = (
            FairnessRecord("gender:women", predicted_positive=True, actual_positive=True),
            FairnessRecord("gender:women", predicted_positive=False, actual_positive=True),
            FairnessRecord("gender:men", predicted_positive=True, actual_positive=True),
            FairnessRecord("gender:men", predicted_positive=True, actual_positive=True),
        )

        assessment = detector.analyze_text("neutral text", fairness_records=records)

        self.assertIsNotNone(assessment.fairness_metrics)
        self.assertGreater(assessment.fairness_metrics.demographic_parity_difference, 0.0)
        self.assertGreater(assessment.fairness_metrics.equal_opportunity_difference, 0.0)


if __name__ == "__main__":
    unittest.main()
*** Add File: c:\Users\Lee Metzger\Desktop\AI Rules\templates\ethics-safety\tests\test_moderator.py
from __future__ import annotations

import pathlib
import sys
import unittest


TEMPLATE_ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(TEMPLATE_ROOT) not in sys.path:
    sys.path.insert(0, str(TEMPLATE_ROOT))


from moderator import ContentModerator


class ContentModeratorTests(unittest.TestCase):
    def test_blocks_critical_harm(self) -> None:
        moderator = ContentModerator()

        result = moderator.moderate("We should kill all of them immediately.")

        self.assertEqual("block", result.decision)
        self.assertTrue(any(issue.category == "hate_speech" for issue in result.issues))

    def test_reviews_unverified_claims(self) -> None:
        moderator = ContentModerator()

        result = moderator.moderate("This treatment is a guaranteed cure and is always true.")

        self.assertEqual("review", result.decision)
        self.assertTrue(any(issue.category == "misinformation" for issue in result.issues))

    def test_allows_technical_context_when_allowance_applies(self) -> None:
        moderator = ContentModerator(block_threshold="critical")

        result = moderator.moderate("Kill the process after the deadlock appears.", context="technical")

        self.assertEqual("allow", result.decision)


if __name__ == "__main__":
    unittest.main()
*** Add File: c:\Users\Lee Metzger\Desktop\AI Rules\templates\ethics-safety\tests\test_chat_service_middleware.py
from __future__ import annotations

import pathlib
import sys
import unittest


TEMPLATE_ROOT = pathlib.Path(__file__).resolve().parents[1]
if str(TEMPLATE_ROOT) not in sys.path:
    sys.path.insert(0, str(TEMPLATE_ROOT))


from chat_service_middleware import ChatModerationMiddleware
from moderator import ContentModerator


class StubChatService:
    def __init__(self, response: str) -> None:
        self.response = response

    def generate_response(self, prompt: str, *, context: str = "general") -> str:
        return self.response


class ChatModerationMiddlewareTests(unittest.TestCase):
    def test_returns_safe_fallback_for_blocked_content(self) -> None:
        middleware = ChatModerationMiddleware(
            StubChatService("We should kill all of them immediately."),
            moderator=ContentModerator(),
        )

        result = middleware.generate_response("unsafe prompt")

        self.assertTrue(result.blocked)
        self.assertNotEqual("We should kill all of them immediately.", result.content)

    def test_uses_review_handler_for_review_decisions(self) -> None:
        middleware = ChatModerationMiddleware(
            StubChatService("This is a guaranteed cure and always true."),
            moderator=ContentModerator(),
            review_handler=lambda moderation: moderation.decision == "review",
        )

        result = middleware.generate_response("review prompt")

        self.assertFalse(result.blocked)
        self.assertTrue(result.review_required)


if __name__ == "__main__":
    unittest.main()
