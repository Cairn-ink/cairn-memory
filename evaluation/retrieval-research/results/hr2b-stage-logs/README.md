Coordinator stage records for HR-2b (protocol v1.1, freeze `d3a6e24f`): one
directory per procedure step, each stage with its exact command (`*.command`),
its full output (`*.log`) and its actual exit code (`*.exit`), plus the
preflight (checkout commit and cleanliness, Node version). The home directory
prefix is written as `~` in these files (in step 3 and step 4 it was replaced
after the run; from step 5 on the helper writes it that way); nothing else in
any log was edited. Step 5's stage root is promoted whole to
`results/hr2b-final/`.
