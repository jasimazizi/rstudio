
/*
 * shortcode_block.ts
 *
 * Copyright (C) 2019-20 by RStudio, PBC
 *
 * Unless you have received this program directly from RStudio pursuant
 * to the terms of a commercial license agreement with RStudio, then
 * this program is licensed to you under the terms of version 3 of the
 * GNU Affero General Public License. This program is distributed WITHOUT
 * ANY EXPRESS OR IMPLIED WARRANTY, INCLUDING THOSE OF NON-INFRINGEMENT,
 * MERCHANTABILITY OR FITNESS FOR A PARTICULAR PURPOSE. Please refer to the
 * AGPL (http://www.gnu.org/licenses/agpl-3.0.txt) for more details.
 *
 */

import { Node as ProsemirrorNode, Schema } from 'prosemirror-model';
import { EditorState, Transaction } from 'prosemirror-state';

import { setTextSelection } from 'prosemirror-utils';

import { PandocExtensions, PandocOutput, PandocTokenType, PandocToken, tokensCollectText, ProsemirrorWriter } from '../api/pandoc';
import { PandocCapabilities } from '../api/pandoc_capabilities';
import { EditorFormat, kHugoDocType } from '../api/format';

import { EditorUI } from '../api/ui';
import { Extension } from '../api/extension';
import { codeNodeSpec } from '../api/code';
import { ProsemirrorCommand, EditorCommandId } from '../api/command';
import { canInsertNode } from '../api/node';
import { kShortcodeRegEx } from '../api/shortcode';
import { PandocBlockCapsuleFilter, blockCapsuleParagraphTokenHandler, encodedBlockCapsuleRegex, PandocBlockCapsule, blockCapsuleTextHandler, parsePandocBlockCapsule, blockCapsuleSourceWithoutPrefix } from '../api/pandoc_capsule';

const extension = (
  _exts: PandocExtensions, 
  _caps: PandocCapabilities, 
  _ui: EditorUI,
  format: EditorFormat)
: Extension | null => {

  // return null if no shortcodes
  if (!format.hugoExtensions.shortcodes) {
    return null;
  }

  return {
    nodes: [
      {
        name: 'shortcode_block',
  
        spec: {
          ...codeNodeSpec(),
          attrs: {},
          parseDOM: [
            {
              tag: "div[class*='shortcode-block']",
              preserveWhitespace: 'full',
            },
          ],
          toDOM(node: ProsemirrorNode) {
            return ['div', { class: 'shortcode-block pm-fixedwidth-font pm-code-block pm-markup-text-color' }, 0];
          },
        },
  
        code_view: {
          lang: () => 'text',
          borderColorClass: 'pm-raw-block-border',
        },

        attr_edit: () => ({
          type: (schema: Schema) => schema.nodes.shortcode_block,
          tags: () => ['shortcode'],
          editFn: () => () => false,
        }),
  
        pandoc: {
         
          // unroll shortcode from paragraph with single shortcode
          blockReader: (schema: Schema, tok: PandocToken, writer: ProsemirrorWriter) => { 
            if (isParaWrappingShortcode(tok)) {
              const text = tokensCollectText(tok.c);
              writer.addNode(schema.nodes.shortcode_block, {}, [schema.text(text)]);
              return true;
            } else {
              return false;
            }
          },

          // capture shortcuts w/ begin/end tags
          blockCapsuleFilter: shortcodeBlockCapsuleFilter(),

          writer: (output: PandocOutput, node: ProsemirrorNode) => {
            output.writeToken(PandocTokenType.Para, () => {
              output.writeRawMarkdown(node.content);
            });
          },
        },
      },
    ],
  
    commands: (schema: Schema) => {
  
      // only create command for hugo doc types
      if (!format.docTypes.includes(kHugoDocType)) {
        return [];
      }
  
      return [
        new ProsemirrorCommand(
          EditorCommandId.Shortcode,
          [],
          (state: EditorState, dispatch?: (tr: Transaction<any>) => void) => {
            // enable/disable command
            if (!canInsertNode(state, schema.nodes.shortcode_block)) {
              return false;
            }
            if (dispatch) {
              const tr = state.tr;
              const shortcode = '{{<  >}}';
              const shortcodeNode = schema.nodes.shortcode_block.create({}, schema.text(shortcode));
              tr.replaceSelectionWith(shortcodeNode);
              setTextSelection(tr.mapping.map(state.selection.from) - (shortcode.length/2) - 1)(tr);
              dispatch(tr);
            }
            return true;
          },
        ),
      ];
    },
  };
};

function isParaWrappingShortcode(tok: PandocToken) {
  if (tok.t === PandocTokenType.Para) {
    const children: PandocToken[] = tok.c;
    const text = tokensCollectText(children);
    return !!text.match(kShortcodeRegEx);
  } 
  return false;
}


export function shortcodeBlockCapsuleFilter() : PandocBlockCapsuleFilter {

  const kShortcodeBlockCapsuleType = 'B65B58FD-D707-4C30-8C97-3D99ACF9A157'.toLowerCase();

  return {

    type: kShortcodeBlockCapsuleType,
    
    match: /^([\t >]*)(\{\{<\s+([^\/][^\t ]+).*?>\}\}[ \t]*\n(?![ \t]*\n)[\W\w]*?\n[\t >]*\{\{<\s+\/\3\s+>\}\})([ \t]*)$/gm,

    extract: (_match: string, p1: string, p2: string, _p3: string, p4: string) => {
      return {
        prefix: p1,
        source: p2,
        suffix: p4
      };
    },
    
    // textually enclose the capsule so that pandoc parses it as the type of block we want it to
    // (in this case we don't do anything because pandoc would have written this table as a 
    // semantically standalone block)
    enclose: (capsuleText: string, capsule: PandocBlockCapsule) => {
      return capsuleText;
    },

    // look for one of our block capsules within pandoc ast text (e.g. a code or raw block)
    // and if we find it, parse and return the original source code
    handleText: blockCapsuleTextHandler(
      kShortcodeBlockCapsuleType, 
      encodedBlockCapsuleRegex(undefined, undefined, 'gm'),
    ),
  
    // we are looking for a paragraph token consisting entirely of a block capsule of our type. 
    // if find that then return the block capsule text
    handleToken: blockCapsuleParagraphTokenHandler(kShortcodeBlockCapsuleType),

    // write the node 
    writeNode: (schema: Schema, writer: ProsemirrorWriter, capsule: PandocBlockCapsule) => {

      // remove the source prefix
      const source = blockCapsuleSourceWithoutPrefix(capsule.source, capsule.prefix);

      // write the node
      writer.addNode(schema.nodes.shortcode_block, {}, [schema.text(source)]);
     
    }
  };
}


export default extension;




