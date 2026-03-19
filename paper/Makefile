MAIN = main

all: $(MAIN).pdf

$(MAIN).pdf: $(MAIN).tex arxiv.sty
	pdflatex $(MAIN)
	pdflatex $(MAIN)

arxiv.sty:
	curl -sL https://raw.githubusercontent.com/kourgeorge/arxiv-style/master/arxiv.sty -o arxiv.sty

clean:
	rm -f $(MAIN).pdf $(MAIN).aux $(MAIN).log $(MAIN).out $(MAIN).bbl $(MAIN).blg

.PHONY: all clean
