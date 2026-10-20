# Self-review rubric

Before the run, record scope and which criteria would make a proposal unacceptable. Use pass / revise / defer with a concrete reason; do not equate a format check with semantic success.

1. **Useful capability:** Can a reader tell what event starts this behavior and what it achieves without knowing file names? A folder name or an implementation noun alone is not enough.
2. **Coherent boundary:** Are entry, implementation, shared support and tests kept distinct? Are labels needlessly duplicating the same behavior? A shared helper may be mapped to multiple functions without implying a dependency.
3. **Evidence:** Can each main claim be traced to inspected source and relevant original relations? Are mapped IDs from this fixed snapshot? Is a quoted line sufficient to support its explanation?
4. **Limitation:** Is at least one actual early return, failure path or constrained result examined? Candidate calls and unknown external steps remain unknown. Never invent business guarantees.
5. **Review cost:** Can a reviewer quickly locate the interesting code and the uncertain part? Avoid annotating every utility or generating duplicate features for every guard.
6. **Existing decisions:** Are accepted/rejected annotations preserved? A successful new output must not silently replace the original document.

Save the first raw draft even when poor. Record what you changed in the Skill, the queries repeated and the effect on the revised result. Report the experiment as author self-use; it does not establish performance for smaller models, trigger reliability across hosts, or an accuracy percentage. A deterministic CI replay only tests the protocol and frozen example.
