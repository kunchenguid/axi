# Benchmark Results

## Summary

| Condition | Tasks | Avg Input Tokens | Cache% | Avg Output Tokens | Avg Cost | Total Cost | Avg Duration | Avg Turns | Success% |
|-----------|-------|-----------------|--------|-------------------|----------|------------|-------------|-----------|----------|
| cli | 85 | 47076 | 79% | 573 | $0.0539 | $4.58 | 17.4s | 3 | 86% |
| axi | 85 | 46462 | 81% | 469 | $0.0502 | $4.26 | 15.7s | 3 | 100% |
| mcp-with-toolsearch | 85 | 153621 | 86% | 2087 | $0.1465 | $12.45 | 41.1s | 8 | 82% |
| mcp-no-toolsearch | 85 | 175757 | 90% | 1515 | $0.1481 | $12.59 | 34.2s | 6 | 87% |
| mcp-with-code-mode | 85 | 137409 | 94% | 1932 | $0.1005 | $8.54 | 43.4s | 7 | 84% |

## Per-Task Breakdown

### list_open_issues

| Condition | Avg Input Tokens | Cache% | Avg Output Tokens | Avg Cost | Total Cost | Avg Duration | Avg Turns | Success |
|-----------|-----------------|--------|-------------------|----------|------------|-------------|-----------|---------|
| cli | 32143 | 90% | 174 | $0.0235 | $0.1174 | 8.2s | 2 | 5/5 |
| axi | 33195 | 86% | 151 | $0.0281 | $0.1403 | 9.9s | 2 | 5/5 |
| mcp-with-toolsearch | 77619 | 95% | 680 | $0.0455 | $0.2273 | 17.9s | 4 | 5/5 |
| mcp-no-toolsearch | 220680 | 97% | 911 | $0.0998 | $0.4992 | 25.0s | 5 | 5/5 |
| mcp-with-code-mode | 147684 | 97% | 1590 | $0.0858 | $0.4291 | 37.2s | 8 | 5/5 |

### view_pr

| Condition | Avg Input Tokens | Cache% | Avg Output Tokens | Avg Cost | Total Cost | Avg Duration | Avg Turns | Success |
|-----------|-----------------|--------|-------------------|----------|------------|-------------|-----------|---------|
| cli | 32015 | 77% | 175 | $0.0381 | $0.1907 | 8.7s | 2 | 5/5 |
| axi | 32298 | 76% | 152 | $0.0387 | $0.1935 | 8.4s | 2 | 5/5 |
| mcp-with-toolsearch | 51551 | 94% | 299 | $0.0306 | $0.1532 | 12.1s | 3 | 5/5 |
| mcp-no-toolsearch | 83597 | 94% | 209 | $0.0445 | $0.2224 | 8.8s | 2 | 5/5 |
| mcp-with-code-mode | 123742 | 96% | 1150 | $0.0720 | $0.3600 | 28.3s | 7 | 5/5 |

### list_releases

| Condition | Avg Input Tokens | Cache% | Avg Output Tokens | Avg Cost | Total Cost | Avg Duration | Avg Turns | Success |
|-----------|-----------------|--------|-------------------|----------|------------|-------------|-----------|---------|
| cli | 32020 | 77% | 159 | $0.0379 | $0.1897 | 8.9s | 2 | 5/5 |
| axi | 32399 | 76% | 159 | $0.0392 | $0.1960 | 10.8s | 2 | 5/5 |
| mcp-with-toolsearch | 61745 | 85% | 306 | $0.0546 | $0.2730 | 10.9s | 3 | 5/5 |
| mcp-no-toolsearch | 94357 | 80% | 189 | $0.0961 | $0.4805 | 8.1s | 2 | 5/5 |
| mcp-with-code-mode | 67969 | 98% | 618 | $0.0355 | $0.1774 | 18.0s | 4 | 5/5 |

### repo_overview

| Condition | Avg Input Tokens | Cache% | Avg Output Tokens | Avg Cost | Total Cost | Avg Duration | Avg Turns | Success |
|-----------|-----------------|--------|-------------------|----------|------------|-------------|-----------|---------|
| cli | 31953 | 77% | 162 | $0.0377 | $0.1887 | 9.9s | 2 | 5/5 |
| axi | 32119 | 76% | 154 | $0.0381 | $0.1905 | 8.5s | 2 | 5/5 |
| mcp-no-toolsearch | 83855 | 90% | 169 | $0.0557 | $0.2784 | 9.0s | 2 | 5/5 |
| mcp-with-toolsearch | 81088 | 96% | 460 | $0.0423 | $0.2115 | 14.1s | 5 | 5/5 |
| mcp-with-code-mode | 62586 | 97% | 499 | $0.0331 | $0.1655 | 15.7s | 4 | 5/5 |

### list_labels

| Condition | Avg Input Tokens | Cache% | Avg Output Tokens | Avg Cost | Total Cost | Avg Duration | Avg Turns | Success |
|-----------|-----------------|--------|-------------------|----------|------------|-------------|-----------|---------|
| cli | 32396 | 76% | 264 | $0.0409 | $0.2047 | 9.5s | 2 | 0/5 |
| axi | 32981 | 74% | 351 | $0.0443 | $0.2214 | 10.8s | 2 | 5/5 |
| mcp-no-toolsearch | 591766 | 96% | 5935 | $0.3190 | $1.5952 | 107.5s | 18 | 0/5 |
| mcp-with-toolsearch | 624703 | 96% | 7076 | $0.3527 | $1.7636 | 125.2s | 28 | 0/5 |
| mcp-with-code-mode | 70126 | 96% | 744 | $0.0412 | $0.2059 | 17.7s | 4 | 0/5 |

### issue_then_comments

| Condition | Avg Input Tokens | Cache% | Avg Output Tokens | Avg Cost | Total Cost | Avg Duration | Avg Turns | Success |
|-----------|-----------------|--------|-------------------|----------|------------|-------------|-----------|---------|
| cli | 48402 | 84% | 335 | $0.0463 | $0.2313 | 11.2s | 3 | 5/5 |
| axi | 49275 | 83% | 330 | $0.0485 | $0.2423 | 13.4s | 3 | 5/5 |
| mcp-with-code-mode | 147925 | 97% | 1925 | $0.0896 | $0.4479 | 39.1s | 8 | 5/5 |
| mcp-no-toolsearch | 128226 | 96% | 482 | $0.0648 | $0.3240 | 13.8s | 3 | 5/5 |
| mcp-with-toolsearch | 87676 | 96% | 740 | $0.0503 | $0.2513 | 20.2s | 5 | 5/5 |

### pr_then_checks

| Condition | Avg Input Tokens | Cache% | Avg Output Tokens | Avg Cost | Total Cost | Avg Duration | Avg Turns | Success |
|-----------|-----------------|--------|-------------------|----------|------------|-------------|-----------|---------|
| cli | 50666 | 81% | 414 | $0.0553 | $0.2763 | 14.7s | 3 | 5/5 |
| axi | 49534 | 83% | 374 | $0.0501 | $0.2503 | 13.9s | 3 | 5/5 |
| mcp-with-code-mode | 127723 | 97% | 2238 | $0.0872 | $0.4359 | 45.9s | 7 | 5/5 |
| mcp-no-toolsearch | 188447 | 95% | 1435 | $0.1116 | $0.5579 | 32.1s | 4 | 5/5 |
| mcp-with-toolsearch | 85769 | 91% | 1685 | $0.0774 | $0.3869 | 35.1s | 5 | 5/5 |

### release_then_body

| Condition | Avg Input Tokens | Cache% | Avg Output Tokens | Avg Cost | Total Cost | Avg Duration | Avg Turns | Success |
|-----------|-----------------|--------|-------------------|----------|------------|-------------|-----------|---------|
| cli | 35342 | 69% | 293 | $0.0523 | $0.2615 | 11.7s | 2 | 5/5 |
| axi | 53677 | 83% | 307 | $0.0528 | $0.2641 | 14.3s | 3 | 5/5 |
| mcp-no-toolsearch | 87409 | 90% | 321 | $0.0602 | $0.3009 | 11.4s | 2 | 5/5 |
| mcp-with-code-mode | 151772 | 95% | 2075 | $0.1027 | $0.5136 | 43.1s | 8 | 5/5 |
| mcp-with-toolsearch | 54994 | 90% | 525 | $0.0405 | $0.2027 | 16.0s | 4 | 5/5 |

### run_then_jobs

| Condition | Avg Input Tokens | Cache% | Avg Output Tokens | Avg Cost | Total Cost | Avg Duration | Avg Turns | Success |
|-----------|-----------------|--------|-------------------|----------|------------|-------------|-----------|---------|
| cli | 49842 | 83% | 350 | $0.0496 | $0.2480 | 14.0s | 3 | 5/5 |
| axi | 49549 | 83% | 314 | $0.0484 | $0.2418 | 12.7s | 3 | 5/5 |
| mcp-no-toolsearch | 117859 | 97% | 965 | $0.0633 | $0.3167 | 24.4s | 3 | 4/5 |
| mcp-with-code-mode | 81510 | 97% | 907 | $0.0472 | $0.2358 | 20.3s | 5 | 5/5 |
| mcp-with-toolsearch | 85772 | 93% | 933 | $0.0611 | $0.3057 | 24.0s | 4 | 0/5 |

### ci_failure_investigation

| Condition | Avg Input Tokens | Cache% | Avg Output Tokens | Avg Cost | Total Cost | Avg Duration | Avg Turns | Success |
|-----------|-----------------|--------|-------------------|----------|------------|-------------|-----------|---------|
| cli | 49523 | 82% | 1074 | $0.0610 | $0.3050 | 21.9s | 7 | 5/5 |
| axi | 51457 | 80% | 900 | $0.0649 | $0.3246 | 20.6s | 3 | 5/5 |
| mcp-no-toolsearch | 452303 | 87% | 6844 | $0.7579 | $3.7896 | 176.8s | 15 | 2/5 |
| mcp-with-code-mode | 269865 | 93% | 3572 | $0.1942 | $0.9711 | 94.3s | 12 | 5/5 |
| mcp-with-toolsearch | 629531 | 90% | 7678 | $0.5679 | $2.8395 | 150.7s | 24 | 2/5 |

### pr_review_prep

| Condition | Avg Input Tokens | Cache% | Avg Output Tokens | Avg Cost | Total Cost | Avg Duration | Avg Turns | Success |
|-----------|-----------------|--------|-------------------|----------|------------|-------------|-----------|---------|
| cli | 47382 | 74% | 1058 | $0.0702 | $0.3509 | 24.6s | 4 | 5/5 |
| axi | 49864 | 82% | 603 | $0.0549 | $0.2747 | 18.5s | 3 | 5/5 |
| mcp-with-code-mode | 93272 | 87% | 1651 | $0.0907 | $0.4533 | 34.5s | 5 | 5/5 |
| mcp-with-toolsearch | 56971 | 77% | 1655 | $0.0871 | $0.4354 | 31.1s | 6 | 5/5 |
| mcp-no-toolsearch | 98022 | 86% | 1670 | $0.1001 | $0.5005 | 32.3s | 5 | 5/5 |

### merged_pr_ci_audit

| Condition | Avg Input Tokens | Cache% | Avg Output Tokens | Avg Cost | Total Cost | Avg Duration | Avg Turns | Success |
|-----------|-----------------|--------|-------------------|----------|------------|-------------|-----------|---------|
| axi | 53959 | 83% | 1054 | $0.0642 | $0.3210 | 26.0s | 5 | 5/5 |
| cli | 67703 | 84% | 1175 | $0.0760 | $0.3798 | 41.9s | 4 | 5/5 |
| mcp-with-code-mode | 247838 | 92% | 4168 | $0.2051 | $1.0253 | 104.3s | 13 | 5/5 |
| mcp-with-toolsearch | 356022 | 69% | 8924 | $0.6139 | $3.0696 | 136.1s | 24 | 3/5 |
| mcp-no-toolsearch | 281959 | 80% | 4179 | $0.3398 | $1.6988 | 62.7s | 18 | 3/5 |

### bug_triage_search

| Condition | Avg Input Tokens | Cache% | Avg Output Tokens | Avg Cost | Total Cost | Avg Duration | Avg Turns | Success |
|-----------|-----------------|--------|-------------------|----------|------------|-------------|-----------|---------|
| axi | 81504 | 85% | 1453 | $0.0875 | $0.4374 | 47.2s | 5 | 5/5 |
| cli | 101198 | 84% | 2357 | $0.1143 | $0.5715 | 52.1s | 5 | 3/5 |
| mcp-with-code-mode | 158068 | 91% | 2541 | $0.1323 | $0.6614 | 52.5s | 8 | 5/5 |
| mcp-no-toolsearch | 160970 | 94% | 981 | $0.0923 | $0.4613 | 21.2s | 4 | 5/5 |
| mcp-with-toolsearch | 57925 | 71% | 812 | $0.0878 | $0.4388 | 19.3s | 3 | 5/5 |

### weekly_catchup

| Condition | Avg Input Tokens | Cache% | Avg Output Tokens | Avg Cost | Total Cost | Avg Duration | Avg Turns | Success |
|-----------|-----------------|--------|-------------------|----------|------------|-------------|-----------|---------|
| axi | 39693 | 78% | 599 | $0.0499 | $0.2494 | 15.2s | 4 | 5/5 |
| cli | 35676 | 77% | 545 | $0.0460 | $0.2300 | 13.9s | 4 | 0/5 |
| mcp-with-code-mode | 148518 | 90% | 2767 | $0.1320 | $0.6601 | 53.0s | 8 | 0/5 |
| mcp-no-toolsearch | 101009 | 75% | 605 | $0.1231 | $0.6155 | 16.6s | 4 | 5/5 |
| mcp-with-toolsearch | 98011 | 62% | 1975 | $0.1846 | $0.9231 | 37.2s | 6 | 5/5 |

### find_fix_for_bug

| Condition | Avg Input Tokens | Cache% | Avg Output Tokens | Avg Cost | Total Cost | Avg Duration | Avg Turns | Success |
|-----------|-----------------|--------|-------------------|----------|------------|-------------|-----------|---------|
| axi | 84154 | 89% | 692 | $0.0665 | $0.3323 | 21.3s | 6 | 5/5 |
| cli | 90025 | 84% | 826 | $0.0912 | $0.4561 | 26.4s | 4 | 5/5 |
| mcp-no-toolsearch | 130909 | 92% | 440 | $0.0841 | $0.4204 | 14.9s | 3 | 5/5 |
| mcp-with-code-mode | 152952 | 90% | 2070 | $0.1243 | $0.6214 | 43.3s | 9 | 5/5 |
| mcp-with-toolsearch | 101344 | 87% | 1072 | $0.0927 | $0.4634 | 28.9s | 6 | 5/5 |

### invalid_issue

| Condition | Avg Input Tokens | Cache% | Avg Output Tokens | Avg Cost | Total Cost | Avg Duration | Avg Turns | Success |
|-----------|-----------------|--------|-------------------|----------|------------|-------------|-----------|---------|
| axi | 32063 | 77% | 177 | $0.0382 | $0.1911 | 7.7s | 2 | 5/5 |
| cli | 31984 | 77% | 185 | $0.0382 | $0.1910 | 8.0s | 2 | 5/5 |
| mcp-no-toolsearch | 83268 | 91% | 215 | $0.0527 | $0.2635 | 8.0s | 2 | 5/5 |
| mcp-with-code-mode | 206819 | 91% | 3438 | $0.1667 | $0.8336 | 68.7s | 10 | 5/5 |
| mcp-with-toolsearch | 50345 | 82% | 329 | $0.0511 | $0.2556 | 9.9s | 3 | 5/5 |

### nonexistent_repo

| Condition | Avg Input Tokens | Cache% | Avg Output Tokens | Avg Cost | Total Cost | Avg Duration | Avg Turns | Success |
|-----------|-----------------|--------|-------------------|----------|------------|-------------|-----------|---------|
| axi | 32125 | 76% | 201 | $0.0388 | $0.1939 | 8.1s | 2 | 5/5 |
| cli | 32013 | 77% | 200 | $0.0385 | $0.1925 | 9.5s | 2 | 5/5 |
| mcp-no-toolsearch | 83241 | 92% | 197 | $0.0523 | $0.2615 | 8.2s | 2 | 5/5 |
| mcp-with-code-mode | 77585 | 88% | 884 | $0.0689 | $0.3444 | 21.4s | 5 | 1/5 |
| mcp-with-toolsearch | 50496 | 83% | 330 | $0.0499 | $0.2495 | 9.9s | 3 | 5/5 |

