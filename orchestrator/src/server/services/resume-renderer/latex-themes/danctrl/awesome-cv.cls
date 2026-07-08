%% Start of file `awesome-cv.cls'.
% Awesome CV Class File
%
% This class has been downloaded from:
% https://github.com/posquit0/Awesome-CV
%
% Author:
% Claud D. Park <posquit0.bj@gmail.com>
% http://www.posquit0.com
%
% Notes:
% 1) This class file defines the structure and layout of the template file (cv.tex, resume.tex).
% 2) It has been written in such a way that under most circumstances you
% should not need to edit it.
%
% Class license:
% LPPL v1.3c (http://www.latex-project.org/lppl)
%


%-------------------------------------------------------------------------------
%                Identification
%-------------------------------------------------------------------------------
\ProvidesClass{awesome-cv}[2017/02/05 v1.6.1 Awesome Curriculum Vitae Class]
\NeedsTeXFormat{LaTeX2e}


%-------------------------------------------------------------------------------
%                Class options
%
% (need to be done before the external package loading, for example because
% we need \paperwidth, \paperheight and \@ptsize to be defined before loading
% geometry and fancyhdr)
%-------------------------------------------------------------------------------
% Options for draft or final
\DeclareOption{draft}{\setlength\overfullrule{5pt}}
\DeclareOption{final}{\setlength\overfullrule{0pt}}
% Inherit options of article
\DeclareOption*{%
  \PassOptionsToClass{\CurrentOption}{article}
}
\ProcessOptions\relax
\LoadClass{article}


%-------------------------------------------------------------------------------
%                3rd party packages
%-------------------------------------------------------------------------------
% Needed to make fixed length table
\RequirePackage{array}
% Needed to embed the optional signature image on the cover letter
\RequirePackage{graphicx}
% Needed to handle list environment
\RequirePackage{enumitem}
% Needed to handle text alignment
\RequirePackage{ragged2e}
% Needed to configure page layout
\RequirePackage{geometry}
% Needed to make header & footer efficiently
\RequirePackage{fancyhdr}
% Needed to manage colors
\RequirePackage[xetex]{xcolor}
% Needed to use \ifxetex-\else-\fi statement
\RequirePackage{ifxetex}
% Needed to use \if-\then-\else statement
\RequirePackage{xifthen}
% Needed to strip chars from telephone number
\RequirePackage{xstring}
% Needed to use a toolbox of programming tools
\RequirePackage{etoolbox}
% Needed to change line spacing in specific environment
\RequirePackage{setspace}
% Needed to prevent section titles from breaking across pages
\RequirePackage{needspace}
% Needed to manage fonts
\RequirePackage[quiet]{fontspec}
% To support LaTeX quoting style
\defaultfontfeatures{Ligatures=TeX}
% Needed to manage math fonts
\RequirePackage{unicode-math}
% Needed to use icons from font-awesome
\RequirePackage{fontawesome5}
% Needed for the photo ID
\RequirePackage[skins]{tcolorbox}
% Needed to deal a paragraphs
\RequirePackage{parskip}
% Needed for dot-grid background
\RequirePackage{eso-pic}
\RequirePackage{tikz}
% Needed to deal hyperlink
\RequirePackage[hidelinks,unicode,pdfpagelabels=false]{hyperref}
\hypersetup{%
  pdftitle={},
  pdfauthor={},
  pdfsubject={},
  pdfkeywords={}
}
% Solves issues Warning: File `cv.out' has changed
\RequirePackage{bookmark}

%-------------------------------------------------------------------------------
%                Font setup (Poppins + JetBrains Mono via fontspec)
%-------------------------------------------------------------------------------
% Load fonts by file path from the bundled ./fonts/ directory.
% This makes rendering self-contained: the compiler (tectonic/xelatex) finds the
% fonts in the render working directory without any system font installation.
% \acvfontdir is set by the template before \documentclass loads this class;
% default to ./fonts/ so the class still works standalone.
\providecommand{\acvfontdir}{fonts/}
\setmainfont{Poppins}[
  Path           = \acvfontdir,
  Extension      = .otf,
  UprightFont    = *-Regular,
  BoldFont       = *-SemiBold,
  ItalicFont     = *-Italic,
  BoldItalicFont = *-SemiBoldItalic,
]
\setmonofont{JetBrainsMono}[
  Path        = \acvfontdir,
  Extension   = .ttf,
  UprightFont = *-Regular,
  BoldFont    = *-Bold,
]
% Named family for the JetBrains Mono Bold header name (used by header styles).
\newfontfamily\jetbrainsmonobold{JetBrainsMono-Bold}[
  Path      = \acvfontdir,
  Extension = .ttf,
]

%-------------------------------------------------------------------------------
%                Configuration for directory locations
%-------------------------------------------------------------------------------
% Configure an optional directory location for fonts(default: 'fonts/')
% Not required anymore but left in place for backward compatability.
\newcommand*{\fontdir}[1][fonts/]{\def\@fontdir{#1}}

%-------------------------------------------------------------------------------
%                Configuration for layout
%-------------------------------------------------------------------------------
%% Page Layout
% Configure page margins with geometry
\geometry{left=1.4cm, top=1.2cm, right=1.4cm, bottom=1.8cm, footskip=.5cm}


%% Header & Footer
% Set offset to each header and footer
\fancyhfoffset{0em}
% Remove head rule
\renewcommand{\headrulewidth}{0pt}
% Clear all header & footer fields
\fancyhf{}
% Enable if you want to make header or footer using fancyhdr
\pagestyle{fancy}


%-------------------------------------------------------------------------------
%                Configuration for colors
%-------------------------------------------------------------------------------
% Gray-scale colors
\definecolor{white}{HTML}{FFFFFF}
\definecolor{black}{HTML}{000000}
\definecolor{darkgray}{HTML}{333333}
\definecolor{gray}{HTML}{5D5D5D}
\definecolor{lightgray}{HTML}{999999}
% Basic colors
\definecolor{green}{HTML}{C2E15F}
\definecolor{orange}{HTML}{FDA333}
\definecolor{purple}{HTML}{D3A4F9}
\definecolor{red}{HTML}{FB4485}
\definecolor{blue}{HTML}{6CE0F1}
% Text colors — updated to match website design system
\definecolor{darktext}{HTML}{1a1a1a}
\definecolor{mutedtext}{HTML}{374151}
\colorlet{text}{darktext}
\colorlet{graytext}{mutedtext}
\colorlet{lighttext}{lightgray}
\definecolor{sectiondivider}{RGB}{229,229,229}
% Awesome colors
\definecolor{awesome-emerald}{HTML}{059669}
\definecolor{awesome-skyblue}{HTML}{0395DE}
\definecolor{awesome-red}{HTML}{DC3522}
\definecolor{awesome-pink}{HTML}{EF4089}
\definecolor{awesome-orange}{HTML}{FF6138}
\definecolor{awesome-nephritis}{HTML}{27AE60}
\definecolor{awesome-concrete}{HTML}{95A5A6}
\definecolor{awesome-darknight}{HTML}{131A28}
\colorlet{awesome}{awesome-emerald}

% Boolean value to switch section color highlighting
\newbool{acvSectionColorHighlight}
\setbool{acvSectionColorHighlight}{true}

% Awesome section color
\def\@sectioncolor#1#2#3{%
  \ifbool{acvSectionColorHighlight}{{\color{awesome}#1#2#3}}{#1#2#3}%
}


%-------------------------------------------------------------------------------
%                Configuration for fonts
%-------------------------------------------------------------------------------
% Font weight commands using Poppins family names
\newcommand*{\headerfont}{\bfseries}
\newcommand*{\headerfontlight}{\mdseries}
\newcommand*{\footerfont}{\normalfont}
\newcommand*{\bodyfont}{\normalfont}
\newcommand*{\bodyfontlight}{\mdseries}

%-------------------------------------------------------------------------------
%                Configuration for styles
%-------------------------------------------------------------------------------
% Configure styles for each CV elements
% For fundamental structures
\newcommand*{\headerfirstnamestyle}[1]{{\fontsize{30pt}{1em}\jetbrainsmonobold\addfontfeature{LetterSpace=8.0}\color{darktext} #1}}
\newcommand*{\headerlastnamestyle}[1]{{\fontsize{30pt}{1em}\jetbrainsmonobold\addfontfeature{LetterSpace=8.0}\color{darktext} #1}}
\newcommand*{\headerpositionstyle}[1]{{\fontsize{11pt}{1em}\ttfamily\color{graytext} #1}}
\newcommand*{\headeraddressstyle}[1]{{\fontsize{8pt}{1em}\headerfont\itshape\color{lighttext} #1}}
\newcommand*{\headersocialstyle}[1]{{\fontsize{8pt}{10pt}\selectfont\ttfamily\color{text} #1}}
\newcommand*{\headerquotestyle}[1]{{\fontsize{9pt}{1em}\bodyfont\itshape\color{darktext} #1}}
\newcommand*{\footerstyle}[1]{{\fontsize{7pt}{1em}\footerfont\scshape\color{lighttext} #1}}
\newcommand*{\sectionstyle}[1]{{\fontsize{16pt}{1em}\ttfamily\bfseries\color{text}\@sectioncolor #1}}
\newcommand*{\subsectionstyle}[1]{{\fontsize{12pt}{1em}\bodyfont\scshape\textcolor{text}{#1}}}
\newcommand*{\paragraphstyle}{\fontsize{9.5pt}{1.4em}\bodyfontlight\upshape\color{text}}
% Lead paragraph used for the (heading-less) summary: a touch larger and airier
% than the body paragraph so it reads as an intro.
\newcommand*{\summarystyle}{\fontsize{10.5pt}{1.55em}\bodyfontlight\upshape\color{darktext}}

% For elements of entry
\newcommand*{\entrytitlestyle}[1]{{\fontsize{10pt}{1em}\bodyfont\bfseries\color{darktext} #1}}
\newcommand*{\entrypositionstyle}[1]{{\fontsize{8pt}{1em}\ttfamily\color{graytext} #1}}
\newcommand*{\entrydatestyle}[1]{{\fontsize{8pt}{10pt}\selectfont\ttfamily\color{graytext} #1}}
\newcommand*{\entrylocationstyle}[1]{{\fontsize{8pt}{10pt}\selectfont\bodyfont\color{awesome} #1}}
\newcommand{\descriptionstyle}[1]{{\fontsize{9.5pt}{1.4em}\bodyfont\upshape\color{text} #1}}

% For elements of subentry
\newcommand*{\subentrytitlestyle}[1]{{\fontsize{8pt}{1em}\bodyfont\mdseries\color{graytext} #1}}
\newcommand*{\subentrypositionstyle}[1]{{\fontsize{7pt}{1em}\bodyfont\scshape\color{graytext} #1}}
\newcommand*{\subentrydatestyle}[1]{{\fontsize{7pt}{1em}\bodyfontlight\slshape\color{graytext} #1}}
\newcommand*{\subentrylocationstyle}[1]{{\fontsize{7pt}{1em}\bodyfontlight\slshape\color{awesome} #1}}
\newcommand*{\subdescriptionstyle}[1]{{\fontsize{8pt}{1em}\bodyfontlight\upshape\color{text} #1}}

% For elements of honor
\newcommand*{\honortitlestyle}[1]{{\fontsize{9pt}{1em}\bodyfont\color{graytext} #1}}
\newcommand*{\honorpositionstyle}[1]{{\fontsize{9pt}{1em}\bodyfont\bfseries\color{darktext} #1}}
\newcommand*{\honordatestyle}[1]{{\fontsize{9pt}{1em}\ttfamily\color{graytext} #1}}
\newcommand*{\honorlocationstyle}[1]{{\fontsize{8pt}{10pt}\selectfont\bodyfont\color{awesome} #1}}

% For elements of skill
\newcommand*{\skilltypestyle}[1]{{\fontsize{10pt}{1em}\bodyfont\bfseries\color{darktext} #1}}
\newcommand*{\skillsetstyle}[1]{{\fontsize{9pt}{1em}\bodyfont\color{graytext} #1}}

% For elements of the cover letter
\newcommand*{\lettersectionstyle}[1]{{\fontsize{14pt}{1em}\bodyfont\bfseries\color{text}\@sectioncolor #1}}
\newcommand*{\recipientaddressstyle}[1]{{\fontsize{9pt}{1em}\bodyfont\scshape\color{graytext} #1}}
\newcommand*{\recipienttitlestyle}[1]{{\fontsize{11pt}{1em}\bodyfont\bfseries\color{darktext} #1}}
\newcommand*{\lettertitlestyle}[1]{{\fontsize{10pt}{1em}\bodyfontlight\bfseries\color{darktext} \underline{#1}}}
\newcommand*{\letterdatestyle}[1]{{\fontsize{9pt}{1em}\selectfont\ttfamily\color{graytext} #1}}
\newcommand*{\lettertextstyle}{\fontsize{10pt}{1.4em}\bodyfontlight\upshape\color{graytext}}
\newcommand*{\letternamestyle}[1]{{\fontsize{10pt}{1em}\bodyfont\bfseries\color{darktext} #1}}
\newcommand*{\letterenclosurestyle}[1]{{\fontsize{10pt}{1em}\bodyfontlight\slshape\color{lighttext} #1}}


%-------------------------------------------------------------------------------
%                Commands for personal information
%-------------------------------------------------------------------------------
% Define photo ID
% Usage: \photo[circle|rectangle,edge|noedge,left|right]{<path-to-image>}
\newcommand{\photo}[2][circle,edge,left]{%
  \def\@photo{#2}
  \@for\tmp:=#1\do{%
    \ifthenelse{\equal{\tmp}{circle} \or \equal{\tmp}{rectangle}}%
      {\let\@photoshape\tmp}{}%
    \ifthenelse{\equal{\tmp}{edge} \or \equal{\tmp}{noedge}}%
      {\let\@photoedge\tmp}{}%
    \ifthenelse{\equal{\tmp}{left} \or \equal{\tmp}{right}}%
      {\let\@photoalign\tmp}{}%
  }%
}
\def\@photoshape{circle}
\def\@photoedge{edge}
\def\@photoalign{left}

% Define writer's name
% Usage: \name{<firstname>}{<lastname>}
% Usage: \firstname{<firstname>}
% Usage: \lastname{<lastname>}
% Usage: \familyname{<familyname>}
\newcommand*{\name}[2]{\def\@firstname{#1}\def\@lastname{#2}}
\newcommand*{\firstname}[1]{\def\@firstname{#1}}
\newcommand*{\lastname}[1]{\def\@lastname{#1}}
\newcommand*{\familyname}[1]{\def\@lastname{#1}}
\def\@familyname{\@lastname}

% Define writer's address
% Usage: \address{<address>}
\newcommand*{\address}[1]{\def\@address{#1}}

% Define writer's position
% Usage: \position{<position>}
\newcommand*{\position}[1]{\def\@position{#1}}

% Defines writer's mobile (optional)
% Usage: \mobile{<mobile number>}
\newcommand*{\mobile}[1]
{
  \def\@mobile{#1}
  \def\@teluri{tel:\@mobile}
  % Strip unwanted characters
  \StrDel{\@teluri}{ }[\@teluri]%
  \StrDel{\@teluri}{-}[\@teluri]%
  \StrDel{\@teluri}{(}[\@teluri]%
  \StrDel{\@teluri}{)}[\@teluri]%
}

% Defines writer's email (optional)
% Usage: \email{<email address>}
\newcommand*{\email}[1]{\def\@email{#1}}

% Defines writer's date of birth (optional)
% Usage: \dateofbirth{<date>}
\newcommand*{\dateofbirth}[1]{\def\@dateofbirth{#1}}

% Defines writer's homepage (optional)
% Usage: \homepage{<url>}
\newcommand*{\homepage}[1]{\def\@homepage{#1}}

% Defines writer's github (optional)
% Usage: \github{<github-nick>}
\newcommand*{\github}[1]{\def\@github{#1}}

% Defines writer's gitlab (optional)
% Usage: \gitlab{<gitlab-nick>}
\newcommand*{\gitlab}[1]{\def\@gitlab{#1}}

% Defines writer's bitbucket (optional)
% Usage: \bitbucket{<bitbucket-nick>}
\newcommand*{\bitbucket}[1]{\def\@bitbucket{#1}}

% Defines writer's stackoverflow profile (optional)
% Usage: \stackoverflow{<so userid>}{<so username>}
%   e.g.https://stackoverflow.com/users/123456/sam-smith
%       would be \stackoverflow{123456}{sam-smith}
\newcommand*{\stackoverflow}[2]{\def\@stackoverflowid{#1}\def\@stackoverflowname{#2}}

% Defines writer's linked-in (optional)
% Usage: \linkedin{<linked-in-nick>}
\newcommand*{\linkedin}[1]{\def\@linkedin{#1}}

% Defines writer's orcid (optional)
% Usage: \orcid{<orcid-num>}
\newcommand*{\orcid}[1]{\def\@orcid{#1}}

% Defines writer's twitter (optional)
% Usage: \twitter{<twitter handle>}
\newcommand*{\twitter}[1]{\def\@twitter{#1}}

% Defines writer's instagram (optional)
% Usage: \instagram{<instagram handle>}
\newcommand*{\instagram}[1]{\def\@instagram{#1}}

% Pre-composed social-links row for the header (built generically by the
% resume/cover-letter builders). Usage: \headersociallinks{<latex>}
\newcommand*{\headersociallinks}[1]{\def\@headersociallinks{#1}}

% Defines writer's Mastodon (optional)
% Usage: \mastodon{<instance>}{<mastodon-nick>}
\newcommand*{\mastodon}[2]{\def\@mastodoninstance{#1}\def\@mastodonname{#2}}

% Defines writer's resarchgate (optional)
% Usage: \researchgate{<researchgate-account>}
\newcommand*{\researchgate}[1]{\def\@researchgate{#1}}

% Defines writer's skype (optional)
% Usage: \skype{<skype account>}
\newcommand*{\skype}[1]{\def\@skype{#1}}

% Defines writer's reddit (optional)
% Usage: \reddit{<reddit account>}
\newcommand*{\reddit}[1]{\def\@reddit{#1}}

% Defines writer's xing (optional)
% Usage: \xing{<xing name>}
\newcommand*{\xing}[1]{\def\@xing{#1}}

% Defines writer's medium profile (optional)
% Usage: \medium{<medium account>}
\newcommand*{\medium}[1]{\def\@medium{#1}}

% Defines writer's kaggle (optional)
% Usage: \kaggle{<kaggle handle>}
\newcommand*{\kaggle}[1]{\def\@kaggle{#1}}

% Defines writer's Hackerrank (optional)
% Usage: \hackerrank{<Hackerrank profile name>}
\newcommand*{\hackerrank}[1]{\def\@hackerrank{#1}}

% Defines writer's Telegram (optional)
% Usage: \telegram{<Telegram username>}
\newcommand*{\telegram}[1]{\def\@telegram{#1}}

% Defines writer's google scholar profile (optional)
% Usage: \googlescholar{<googlescholar userid>}{<googlescholar username>}
% e.g.https://scholar.google.co.uk/citations?user=wpZDx1cAAAAJ
% would be \googlescholar{wpZDx1cAAAAJ}{Name-to-display-next-icon}
% If 'googlescholar-name' is not provided than it defaults to
% '\firstname \lastname'
\newcommand*{\googlescholar}[2]{%
  \def\@googlescholarid{#1}%
  \ifthenelse{\equal{#2}{}}{%
    \def\@googlescholarname{\@firstname~\@lastname}%
  }{%
    \def\@googlescholarname{#2}%
  }%
}

% Defines writer's extra information (optional)
% Usage: \extrainfo{<extra information>}
\newcommand*{\extrainfo}[1]{\def\@extrainfo{#1}}

% Defines writer's quote (optional)
% Usage: \quote{<quote>}
\renewcommand*{\quote}[1]{\def\@quote{#1}}

% Defines recipient's information (cover letter only)
% Usage: \recipient{<recipient name>}{<recipient address>}
% Usage: \recipientname{<recipient name>}
% Usage: \recipientaddress{<recipient address>}
\newcommand*{\recipient}[2]{\def\@recipientname{#1}\def\@recipientaddress{#2}}
\newcommand*{\recipientname}[1]{\def\@recipientname{#1}}
\newcommand*{\recipientaddress}[1]{\def\@recipientaddress{#1}}

% Defines the title for letter (cover letter only, optional)
% Usage: \lettertitle{<title>}
\newcommand*{\lettertitle}[1]{\def\@lettertitle{#1}}

% Defines the date for letter (cover letter only)
% Usage: \letterdate{<date>}
\newcommand*{\letterdate}[1]{\def\@letterdate{#1}}

% Defines a message of opening for letter (cover letter only)
% Usage: \letteropening{<message>}
\newcommand*{\letteropening}[1]{\def\@letteropening{#1}}

% Defines a message of closing for letter (cover letter only)
% Usage: \letterclosing{<message>}
\newcommand*{\letterclosing}[1]{\def\@letterclosing{#1}}

% Defines an optional handwritten signature image (cover letter only). When set,
% \makeletterclosing renders it above the typed name. Usage: \signature{<path>}
\newcommand*{\signature}[1]{\def\@signature{#1}}

% Defines an enclosure for letter (cover letter only, optional)
% Usage: \letterenclosure[<enclosure name>]{<enclosure>}
\newcommand*{\letterenclname}[1][Enclosure]{\def\@letterenclname{#1}}
\newcommand*{\letterenclosure}[2][]{%
  % if an optional argument is provided, use it to redefine \enclname
  \ifthenelse{\equal{#1}{}}{}{\def\@letterenclname{#1}}
  \def\@letterenclosure{#2}
}


%-------------------------------------------------------------------------------
%                Commands for extra
%-------------------------------------------------------------------------------
%% Define helper macros a user can change easily
% Header
\newcommand{\acvHeaderNameDelim}{\space}
\newcommand{\acvHeaderAfterNameSkip}{2mm}
\newcommand{\acvHeaderAfterPositionSkip}{.4mm}
\newcommand{\acvHeaderAfterAddressSkip}{-.5mm}
\newcommand{\acvHeaderIconSep}{\space}
\newcommand{\acvHeaderSocialSep}{\hspace{1.4em}}
\newcommand{\acvHeaderAfterSocialSkip}{6mm}
\newcommand{\acvHeaderAfterQuoteSkip}{5mm}
% Vertical gap between the personal-info row and the social-links row.
\newcommand{\acvHeaderRowSkip}{1.3mm}

% Vertical rhythm ------------------------------------------------------------
% One shared scale keeps every gap constant regardless of entry type. All of
% these are applied with \addvspace so adjacent spaces MERGE to the larger value
% instead of summing: the gap before a heading is therefore always
% \acvSectionTopSkip, no matter what trailing space the previous entry left.
%   \acvSectionTopSkip        space above every section heading
%   \acvSectionContentTopSkip heading rule -> first entry/row
%   \acvEntryGap              between entries within a section
%   \acvEntryHeadBodySkip     entry subtitle -> its description/bullets
\newcommand{\acvSectionTopSkip}{4.5mm}
\newcommand{\acvSectionContentTopSkip}{2.2mm}
\newcommand{\acvEntryGap}{2.6mm}
\newcommand{\acvEntryHeadBodySkip}{0.8mm}


%-------------------------------------------------------------------------------
%                Commands for utilities
%-------------------------------------------------------------------------------
% Use to align an element of tabular table
\newcolumntype{L}[1]{>{\raggedright\let\newline\\\arraybackslash\hspace{0pt}}m{#1}}
\newcolumntype{C}[1]{>{\centering\let\newline\\\arraybackslash\hspace{0pt}}m{#1}}
\newcolumntype{R}[1]{>{\raggedleft\let\newline\\\arraybackslash\hspace{0pt}}m{#1}}

% Use to draw horizontal line with specific thickness
\def\vhrulefill#1{\leavevmode\leaders\hrule\@height#1\hfill \kern\z@}

% Use to execute conditional statements by checking empty string
\newcommand*{\ifempty}[3]{\ifthenelse{\isempty{#1}}{#2}{#3}}


%-------------------------------------------------------------------------------
%                Commands for elements of CV structure
%-------------------------------------------------------------------------------
% Define a header for CV
% Usage: \makecvheader
\newcommand*{\makecvheader}[1][C]{%
  \newcommand*{\drawphoto}{%
    \ifthenelse{\isundefined{\@photo}}{}{%
      \newlength{\photodim}
      \ifthenelse{\equal{\@photoshape}{circle}}%
        {\setlength{\photodim}{1.3cm}}%
        {\setlength{\photodim}{1.8cm}}%
      \ifthenelse{\equal{\@photoedge}{edge}}%
        {\def\@photoborder{darkgray}}%
        {\def\@photoborder{none}}%
      \begin{tikzpicture}%
        \node[\@photoshape, draw=\@photoborder, line width=0.3mm, inner sep=\photodim, fill overzoom image=\@photo] () {};
      \end{tikzpicture}
    }%
  }
  \newlength{\headertextwidth}
  \newlength{\headerphotowidth}
  \ifthenelse{\isundefined{\@photo}}{
    \setlength{\headertextwidth}{\textwidth}
    \setlength{\headerphotowidth}{0cm}
  }{%
    \setlength{\headertextwidth}{0.76\textwidth}
    \setlength{\headerphotowidth}{0.24\textwidth}
  }%
  \begin{minipage}[c]{\headerphotowidth}%
    \ifthenelse{\equal{\@photoalign}{left}}{\raggedright\drawphoto}{}
  \end{minipage}
  \begin{minipage}[c]{\headertextwidth}
    \ifthenelse{\equal{#1}{L}}{\raggedright}{\ifthenelse{\equal{#1}{R}}{\raggedleft}{\centering}}
    % Nudge the (large, bold) name left so its ink lines up with the smaller
    % position line beneath it, which has a smaller left side-bearing.
    \hspace*{-2pt}\headerfirstnamestyle{\@firstname}\headerlastnamestyle{{}\acvHeaderNameDelim\@lastname}%
    \\[\acvHeaderAfterNameSkip]%
    \ifthenelse{\isundefined{\@position}}{}{\headerpositionstyle{\@position\\[\acvHeaderAfterPositionSkip]}}%
    \par\vspace{3.5mm}%
    \headersocialstyle{%
      \newbool{isstart}%
      \setbool{isstart}{true}%
      \ifthenelse{\isundefined{\@mobile}}%
        {}%
        {%
          \href{\@teluri}{\faPhone\acvHeaderIconSep\@mobile}%
          \setbool{isstart}{false}%
        }%
      \ifthenelse{\isundefined{\@email}}%
        {}%
        {%
          \ifbool{isstart}{\setbool{isstart}{false}}{\acvHeaderSocialSep}%
          \href{mailto:\@email}{\faEnvelope\acvHeaderIconSep\@email}%
        }%
      \ifthenelse{\isundefined{\@dateofbirth}}%
        {}%
        {%
          \ifbool{isstart}{\setbool{isstart}{false}}{\acvHeaderSocialSep}%
          % \mbox prevents wrapping of elements%
          \mbox{\faBirthdayCake\acvHeaderIconSep\@dateofbirth}%
        }%
      \ifthenelse{\isundefined{\@homepage}}%
        {}%
        {%
          \ifbool{isstart}{\setbool{isstart}{false}}{\acvHeaderSocialSep}%
          \href{http://\@homepage}{\faGlobe\acvHeaderIconSep\@homepage}%
        }%
      \ifthenelse{\isundefined{\@address}}%
        {}%
        {%
          \ifbool{isstart}{\setbool{isstart}{false}}{\acvHeaderSocialSep}%
          \mbox{\faMapMarker*\acvHeaderIconSep\@address}%
        }%
      % Social profiles are composed generically by the builder (see
      % header-social.ts) and passed via \headersociallinks. They render on their
      % own row beneath the personal-info row.
      \ifthenelse{\isundefined{\@headersociallinks}}%
        {}%
        {%
          \ifbool{isstart}{}{\\[\acvHeaderRowSkip]}%
          \@headersociallinks%
        }%
    } \\[\acvHeaderAfterSocialSkip]%
    \ifthenelse{\isundefined{\@quote}}%
      {}%
      {\headerquotestyle{\@quote\\}\vspace{\acvHeaderAfterQuoteSkip}}%
  \end{minipage}%
  \begin{minipage}[c]{\headerphotowidth}%
    \ifthenelse{\equal{\@photoalign}{right}}{\raggedleft\drawphoto}{}
  \end{minipage}
}

% Define a footer for CV
% Usage: \makecvfooter{<left>}{<center>}{<right>}
\newcommand*{\makecvfooter}[3]{%
  \fancyfoot{}
  \fancyfoot[L]{\footerstyle{#1}}
  \fancyfoot[C]{\footerstyle{#2}}
  \fancyfoot[R]{\footerstyle{#3}}
}

% Define a section for CV
% Usage: \cvsection{<section-title>}
\newcommand{\cvsection}[1]{%
  % Reserve enough room that a section heading is never printed alone at the
  % bottom of a page; \nobreak then forbids a page break between the heading rule
  % and the first entry that follows it.
  \Needspace{8\baselineskip}
  % \addvspace merges with the trailing space of the previous section's last
  % entry, so the gap above every heading is exactly \acvSectionTopSkip.
  \par\addvspace{\acvSectionTopSkip}
  \sectionstyle{#1}
  \phantomsection
  \color{sectiondivider}\vhrulefill{0.9pt}
  \par\nobreak
}

% Define a subsection for CV
% Usage: \cvsubsection{<subsection-title>}
\newcommand{\cvsubsection}[1]{%
  \vspace{\acvSectionContentTopSkip}
  \vspace{-3mm}
  \subsectionstyle{#1}
  \phantomsection
}

% Define a paragraph for CV
\newenvironment{cvparagraph}{%
  \vspace{\acvSectionContentTopSkip}
  \vspace{-3mm}
  \paragraphstyle
}{%
  \par
  \vspace{2mm}
}

% Define an environment for cventry
\newenvironment{cventries}{%
  % No center env: the entries are full-width and its vertical glue was a hidden
  % source of uneven gaps. \addvspace sets the heading -> first entry gap.
  \par\addvspace{\acvSectionContentTopSkip}%
}{%
  \par%
}
% Define an entry of cv information
% Usage: \cventry{<position>}{<title>}{<location>}{<date>}{<description>}
\newcommand{\cventry}[5]{%
  \setlength\tabcolsep{0pt}
  \setlength{\extrarowheight}{0pt}
  \hfuzz=2pt
  % The whole entry (header rows + description) sits in a full-width minipage so
  % it stays together on one page; page breaks fall BETWEEN entries, never inside
  % one, and a section heading never ends up alone (its first entry moves with it).
  \noindent\begin{minipage}[t]{\linewidth}%
  \begin{tabular*}{\textwidth}{@{\extracolsep{\fill}} L{0.65\textwidth} R{0.35\textwidth}}
    \ifempty{#2#3}
      {\entrypositionstyle{#1} & \entrydatestyle{#4} \\}
      {\entrytitlestyle{#2} & \entrylocationstyle{#3} \\
      \entrypositionstyle{#1} & \entrydatestyle{#4} \\}
  \end{tabular*}%
  % descriptionstyle restores the dark body colour + font for the bullet list.
  \ifstrempty{#5}{}{\par\nobreak\vspace{\acvEntryHeadBodySkip}\descriptionstyle{#5}}%
  \end{minipage}%
  \par\addvspace{\acvEntryGap}%
}

% Define a project entry. Like \cventry, but tuned for projects: it always emits
% a single title|date row (never a forced empty position row, which is what left
% a gap under keyword-less projects), then an optional subtitle line, then the
% description.
% Usage: \cvprojectentry{<title>}{<date>}{<subtitle>}{<description>}
\newcommand{\cvprojectentry}[4]{%
  \setlength\tabcolsep{0pt}
  \setlength{\extrarowheight}{0pt}
  \hfuzz=2pt
  % Same atomic minipage + shared rhythm as \cventry, so projects/prose sections
  % line up identically with experience/education.
  \noindent\begin{minipage}[t]{\linewidth}%
  \begin{tabular*}{\textwidth}{@{\extracolsep{\fill}} L{0.75\textwidth} R{0.25\textwidth}}
    \entrytitlestyle{#1} & \entrydatestyle{#2} \\
    \ifstrempty{#3}{}{\entrypositionstyle{#3} & \\}
  \end{tabular*}%
  \ifstrempty{#4}{}{\par\nobreak\vspace{\acvEntryHeadBodySkip}\begin{justify}\descriptionstyle{#4}\end{justify}}%
  \end{minipage}%
  \par\addvspace{\acvEntryGap}%
}

% Define an environment for cvsubentry
\newenvironment{cvsubentries}{%
  \begin{center}
}{%
  \end{center}
}
% Define a subentry of cv information
% Usage: \cvsubentry{<position>}{<title>}{<date>}{<description>}
\newcommand*{\cvsubentry}[4]{%
  \setlength\tabcolsep{0pt}
  \setlength{\extrarowheight}{0pt}
  \begin{tabular*}{\textwidth}{@{\extracolsep{\fill}} L{\textwidth - 4.5cm} R{4.5cm}}
    \setlength\leftskip{0.2cm}
    \subentrytitlestyle{#2} & \ifthenelse{\equal{#1}{}}
      {\subentrydatestyle{#3}}{}
    \ifthenelse{\equal{#1}{}}
      {}
      {\subentrypositionstyle{#1} & \subentrydatestyle{#3} \\}
    \ifthenelse{\equal{#4}{}}
      {}
      {\multicolumn{2}{L{17.0cm}}{\subdescriptionstyle{#4}} \\}
  \end{tabular*}
}

% Define an environment for cvhonor
\newenvironment{cvhonors}{%
  \par\addvspace{\acvSectionContentTopSkip}%
  \setlength\tabcolsep{0pt}
  \setlength{\extrarowheight}{0pt}
  \begin{tabular*}{\textwidth}{@{\extracolsep{\fill}} C{1.5cm} L{\textwidth - 5.5cm} R{4.0cm}}
}{%
  \end{tabular*}%
  \par%
}
% Define a line of cv information(honor, award or something else)
% Usage: \cvhonor{<position>}{<title>}{<location>}{<date>}
\newcommand*{\cvhonor}[4]{%
  \honordatestyle{#4} & \honorpositionstyle{#1}\ifempty{#2}{}{,} \honortitlestyle{#2} & \honorlocationstyle{#3} \\
}

% Define an environment for cvskill
\newenvironment{cvskills}{%
  \par\addvspace{\acvSectionContentTopSkip}%
  \setlength\tabcolsep{4pt}
  \setlength{\extrarowheight}{2pt}
  \begin{tabular}{@{}>{\raggedright\bfseries}p{0.30\textwidth}>{\raggedright\arraybackslash}p{0.65\textwidth}@{}}
}{%
  \end{tabular}%
  \par%
}
% Define a line of cv information(skill)
% Usage: \cvskill{<type>}{<skillset>}
\newcommand*{\cvskill}[2]{%
  \skilltypestyle{#1} & \skillsetstyle{#2} \\
}

% --- Skill / language pills -------------------------------------------------
% Rounded, outlined chips for skills and languages. The chip text is real,
% selectable PDF text, so ATS parsers still read every keyword.
\definecolor{pillborder}{HTML}{CBD1C8}
\definecolor{pillface}{HTML}{FFFFFF}
\newcommand*{\skillcategorystyle}[1]{{\fontsize{9.5pt}{1em}\bodyfont\bfseries\color{darktext} #1}}
% Language name label (Poppins), shown before the fluency/level pills.
\newcommand*{\languagenamestyle}[1]{{\fontsize{9.5pt}{1em}\bodyfont\bfseries\color{darktext} #1}}
% A fixed, keyword-independent strut: gives every pill identical height AND a
% consistent baseline, so pills in a row are level (no vertical wobble). Its
% asymmetric height/depth (8.2pt up, 2.4pt down) centres the text vertically.
% The strut is prepended to the pill content (via the \cvpill wrapper below)
% rather than passed as a `before upper` key, because a \rule with an optional
% [..] argument inside a tcolorbox key value trips some tcolorbox versions
% ("Argument of \@rule has an extra }").
\newcommand{\cvpillstrut}{\rule[-2.4pt]{0pt}{8.2pt}}
\newtcbox{\cvpillbox}{%
  on line, nobeforeafter, boxrule=0.5pt, arc=1.5mm, boxsep=0pt,
  left=8.5pt, right=8.5pt, top=2.6pt, bottom=2.6pt,
  colframe=pillborder, colback=pillface,
  fontupper={\fontsize{8.5pt}{8.5pt}\selectfont\ttfamily\color{darktext}}%
}
\newcommand{\cvpill}[1]{\cvpillbox{\cvpillstrut #1}}
% Uniform gap between pills. A single, non-stretchable \hspace (no interword
% space, no `plus`) keeps every gap identical; because it is glue directly after
% a pill box it is a legal line-break point and is discarded cleanly on wrap, so
% wrapped rows start flush left with no ragged gaps. 3pt matches the vertical
% gap between wrapped rows (see \cvpillskill baselineskip) for a consistent grid.
\newcommand{\cvpillsep}{\hspace{3pt}}
% A wrapping row of pills. A small leading gap sits under the category heading;
% the baseline skip keeps wrapped pill rows from touching.
\newenvironment{cvpills}{%
  \par\addvspace{\acvSectionContentTopSkip}%
  \setlength{\parindent}{0pt}\raggedright
  \setlength{\baselineskip}{15pt}%
}{%
  \par
}

% Wrapper around the \cvpillskill rows so the heading -> first row gap matches
% every other section (the rows themselves aren't an env like cventries).
\newenvironment{cvpillskills}{%
  \par\addvspace{\acvSectionContentTopSkip}%
}{%
  \par%
}

% Compact skills row: bold category label on the left, wrapping pills on the
% right, so each category costs no extra heading line.
% Usage: \cvpillskill{<category>}{<pills>}
\newcommand{\cvpillskill}[2]{%
  \par\noindent
  % Category label and pills are both anchored at the TOP so the label lines up
  % with the first pill row no matter how many rows the pills wrap to. The label
  % sits in a pill-height slab, vertically centred to match the pill text.
  \parbox[t]{0.27\textwidth}{\raggedright
    \raisebox{-0.5pt}[15pt][0pt]{\parbox[c][15pt][c]{\linewidth}{\raggedright\skillcategorystyle{#1}}}}%
  \hspace{2.5mm}%
  % baselineskip = pill height (14.76pt, measured) + 3pt gap, so the vertical gap
  % between wrapped pill rows equals the 3pt horizontal gap (\cvpillsep) for a
  % square grid, and rows never touch whether the pills span 1 row or many.
  \parbox[t]{0.69\textwidth}{\raggedright\setlength{\baselineskip}{17.76pt}#2\par}%
  \par\vspace{1.8mm}%
}

% Define an environment for cvitems(for cventry). No negative vspaces: the entry
% controls the gap above (\acvEntryHeadBodySkip) and below (\acvEntryGap), so the
% bullet list has the same rhythm as a plain-paragraph description.
\newenvironment{cvitems}{%
  \begin{justify}
  \begin{itemize}[leftmargin=2ex, nosep, noitemsep]
    \setlength{\parskip}{0pt}
    \renewcommand{\labelitemi}{\textcolor{awesome}{\textbullet}}
}{%
  \end{itemize}
  \end{justify}%
}


%-------------------------------------------------------------------------------
%                Commands for elements of Cover Letter
%-------------------------------------------------------------------------------
% Define an environment for cvletter
\newenvironment{cvletter}{%
  \lettertextstyle
}{%
}

% Define a section for the cover letter
% Usage: \lettersection{<section-title>}
\newcommand{\lettersection}[1]{%
  \par\addvspace{2.5ex}
  \phantomsection{}
  \lettersectionstyle{#1}
  \color{sectiondivider}\vhrulefill{0.9pt}
  \par\nobreak\addvspace{0.4ex}
  \lettertextstyle
}

% Define a title of the cover letter
% Usage: \makelettertitle
\newcommand*{\makelettertitle}{%
  \vspace{8.4mm}
  \setlength\tabcolsep{0pt}
  \setlength{\extrarowheight}{0pt}
  \begin{tabular*}{\textwidth}{@{\extracolsep{\fill}} L{\textwidth - 4.5cm} R{4.5cm}}
    \recipienttitlestyle{\@recipientname} & \letterdatestyle{\@letterdate}
  \end{tabular*}
  \begin{singlespace}
    \recipientaddressstyle{\@recipientaddress} \\\\
  \end{singlespace}
  \ifthenelse{\isundefined{\@lettertitle}}
    {}
    {\lettertitlestyle{\@lettertitle} \\}
  \lettertextstyle{\@letteropening}
}

% Define a closing of the cover letter
% Usage: \makeletterclosing
\newcommand*{\makeletterclosing}{%
  \vspace{3.4mm}
  \lettertextstyle{\@letterclosing} \\
  % Room for the signature: the image itself when set, otherwise a blank line.
  \ifthenelse{\isundefined{\@signature}}
    {\\[2mm]}
    {\\[2mm]\includegraphics[height=15mm]{\@signature} \\[1mm]}
  \letternamestyle{\@firstname\ \@lastname}
  \ifthenelse{\isundefined{\@letterenclosure}}
    {\\}
    {%
      \\\\\\
      \letterenclosurestyle{\@letterenclname: \@letterenclosure} \\
    }
}
